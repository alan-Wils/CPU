"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiRequest, setSelectedCompanyId } from "@/lib/api";
import {
  canCreatePlatformCompanies,
  getPortalCompanies,
  isLoggedIn,
  isPortalSession,
  saveAuthSession,
  setPortalCompanies,
  type CpuCompany,
  type CpuUser,
} from "@/lib/auth";
import { loadBackendStore } from "@/lib/backendStore";

function codeToSlug(code: string): string {
  return code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function selectCompanyAndGoHome(companyId: string) {
  const out = await apiRequest<{
    token: string;
    user: CpuUser;
    company: CpuCompany;
  }>("/api/auth/select-company", {
    method: "POST",
    body: { companyId },
    omitCompanyHeader: true,
  });
  saveAuthSession({
    token: out.token,
    user: out.user,
    company: out.company,
  });
  setSelectedCompanyId(out.company.id);
  await loadBackendStore();
  window.location.href = "/";
}

function PortalBody() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [companies, setCompanies] = useState<CpuCompany[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanyCode, setNewCompanyCode] = useState("");
  const [newOwnerEmail, setNewOwnerEmail] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState("");
  const [createSuccess, setCreateSuccess] = useState<{
    companyName: string;
    slug: string;
    ownerEmail: string;
  } | null>(null);

  const fetchAccessibleList = useCallback(async (): Promise<CpuCompany[]> => {
    const raw = await apiRequest<{ companies: CpuCompany[] }>(
      "/api/companies/accessible",
      { omitCompanyHeader: true },
    );
    const list = (raw.companies || []).map((c) => ({
      id: c.id,
      name: c.name,
      code:
        c.code || String((c as { slug?: string }).slug || "").toUpperCase(),
      lifecycleStatus:
        (c as { lifecycleStatus?: string }).lifecycleStatus || "active",
    }));
    setPortalCompanies(list);
    return list;
  }, []);

  const canCreate = canCreatePlatformCompanies();

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!isLoggedIn()) {
        router.replace("/login");
        return;
      }
      if (!isPortalSession()) {
        router.replace("/");
        return;
      }

      const platformCanCreate = canCreatePlatformCompanies();

      try {
        let list = getPortalCompanies();
        if (!list.length) {
          list = await fetchAccessibleList();
        }
        if (cancelled) return;

        if (list.length === 0) {
          if (!platformCanCreate) {
            setError("No companies are assigned to this account.");
            setLoading(false);
            return;
          }
          setCompanies([]);
          setLoading(false);
          return;
        }

        const forcePick = searchParams.get("pick") === "1";
        if (list.length === 1 && !forcePick) {
          await selectCompanyAndGoHome(list[0].id);
          return;
        }
        setCompanies(list);
        setLoading(false);
      } catch {
        if (!cancelled) router.replace("/login");
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [router, searchParams, fetchAccessibleList]);

  async function onPick(companyId: string) {
    setError("");
    setLoading(true);
    try {
      await selectCompanyAndGoHome(companyId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not select company");
      setLoading(false);
    }
  }

  async function onCreateCompany(e: React.FormEvent) {
    e.preventDefault();
    setCreateErr("");
    setCreateSuccess(null);

    const name = newCompanyName.trim();
    const slug = codeToSlug(newCompanyCode);
    const ownerEmail = newOwnerEmail.trim().toLowerCase();

    if (name.length < 2) {
      setCreateErr("Company name must be at least 2 characters.");
      return;
    }
    if (slug.length < 2 || slug.length > 50) {
      setCreateErr(
        "Company code must produce a valid slug (2–50 letters, numbers, or hyphens).",
      );
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
      setCreateErr("Enter a valid owner email.");
      return;
    }

    setCreateBusy(true);
    try {
      await apiRequest("/api/companies", {
        method: "POST",
        omitCompanyHeader: true,
        body: {
          name,
          slug,
          ownerEmail,
        },
      });

      const list = await fetchAccessibleList();
      setCompanies(list);

      setCreateSuccess({
        companyName: name,
        slug,
        ownerEmail,
      });
      setNewCompanyName("");
      setNewCompanyCode("");
      setNewOwnerEmail("");
    } catch (err: unknown) {
      setCreateErr(
        err instanceof Error ? err.message : "Could not create company.",
      );
    } finally {
      setCreateBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    marginTop: 6,
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(148, 163, 184, 0.35)",
    background: "#020617",
    color: "white",
    fontSize: 15,
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontWeight: 700,
    fontSize: 13,
    color: "#94a3b8",
    marginBottom: 4,
  };

  if (loading && !companies.length && !error) {
    return (
      <main
        style={{
          minHeight: "100vh",
          background:
            "radial-gradient(circle at top, #1e293b 0, #020617 45%, #000 100%)",
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <p style={{ color: "#93c5fd", fontWeight: 800 }}>Loading companies…</p>
      </main>
    );
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top, #1e293b 0, #020617 45%, #000 100%)",
        color: "white",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: canCreate ? 640 : 560,
          background: "rgba(15, 23, 42, 0.92)",
          border: "1px solid rgba(148, 163, 184, 0.25)",
          borderRadius: 18,
          padding: 40,
          boxShadow: "0 30px 80px rgba(0,0,0,0.45)",
        }}
      >
        <h1 style={{ marginTop: 0, fontSize: 32, fontWeight: 900 }}>
          NexBatch portal
        </h1>
        <p style={{ color: "#93c5fd", lineHeight: 1.5 }}>
          Choose a company workspace. All modules will load data for that tenant
          only.
        </p>
        {canCreate && (
          <p
            style={{
              color: "#a5b4fc",
              lineHeight: 1.5,
              fontSize: 14,
              marginTop: 12,
            }}
          >
            As NexBatch staff you can create new company workspaces here. Company
            owners are not shown this section.
          </p>
        )}
        {error && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              borderRadius: 12,
              background: "rgba(127, 29, 29, 0.55)",
              border: "1px solid rgba(248, 113, 113, 0.45)",
              color: "#fecaca",
              fontWeight: 700,
            }}
          >
            {error}
          </div>
        )}
        <ul style={{ listStyle: "none", padding: 0, marginTop: 24 }}>
          {companies.length === 0 && !error ? (
            <li style={{ color: "#94a3b8", marginBottom: 12 }}>
              No workspaces assigned yet. {canCreate ? "Create one below." : ""}
            </li>
          ) : (
            companies.map((c) => (
              <li key={c.id} style={{ marginBottom: 12 }}>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => onPick(c.id)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "16px 18px",
                    borderRadius: 12,
                    border: "1px solid rgba(148, 163, 184, 0.35)",
                    background: "#020617",
                    color: "white",
                    fontWeight: 800,
                    fontSize: 18,
                    cursor: loading ? "wait" : "pointer",
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <span>
                      {c.name}{" "}
                      <span style={{ color: "#64748b", fontWeight: 600 }}>
                        ({c.code})
                      </span>
                    </span>
                    {c.lifecycleStatus === "invited" ? (
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 800,
                          padding: "4px 10px",
                          borderRadius: 999,
                          background: "rgba(251, 191, 36, 0.2)",
                          border: "1px solid rgba(251, 191, 36, 0.55)",
                          color: "#fde68a",
                        }}
                      >
                        Invited
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>

        {canCreate && (
          <section
            style={{
              marginTop: 28,
              paddingTop: 28,
              borderTop: "1px solid rgba(148, 163, 184, 0.2)",
            }}
          >
            <h2 style={{ margin: "0 0 12px", fontSize: 20, fontWeight: 800 }}>
              Create company workspace
            </h2>
            <p style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.5 }}>
              Creates the tenant and emails the future application owner an{" "}
              <strong style={{ color: "#cbd5e1" }}>invite link</strong> (same flow as
              Admin → Invite). They accept on the web, set a password, and sign in
              with their company code.{" "}
              <strong style={{ color: "#cbd5e1" }}>
                The owner email must not already belong to a user
              </strong>{" "}
              (including your NexBatch login)—use a dedicated inbox or alias.
            </p>

            {createSuccess && (
              <div
                style={{
                  marginTop: 16,
                  padding: 14,
                  borderRadius: 12,
                  background: "rgba(20, 83, 45, 0.45)",
                  border: "1px solid rgba(34, 197, 94, 0.45)",
                  color: "#bbf7d0",
                  fontSize: 14,
                  lineHeight: 1.55,
                }}
              >
                <strong>Created {createSuccess.companyName}</strong> (slug{" "}
                <code style={{ color: "#86efac" }}>{createSuccess.slug}</code>
                ). It appears in your list as <strong>Invited</strong> until the owner
                accepts. An invitation was sent to{" "}
                <code style={{ color: "#86efac" }}>{createSuccess.ownerEmail}</code>{" "}
                with a link to accept and set their password (check spam if it does
                not arrive within a few minutes).
              </div>
            )}

            {createErr && (
              <div
                style={{
                  marginTop: 14,
                  padding: 12,
                  borderRadius: 12,
                  background: "rgba(127, 29, 29, 0.55)",
                  border: "1px solid rgba(248, 113, 113, 0.45)",
                  color: "#fecaca",
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                {createErr}
              </div>
            )}

            <form
              onSubmit={onCreateCompany}
              style={{ marginTop: 18, display: "grid", gap: 14 }}
              autoComplete="off"
            >
              <label style={labelStyle}>
                Company name
                <input
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  style={inputStyle}
                  placeholder="Acme Cultivation"
                  name="nb-new-company-name"
                />
              </label>
              <label style={labelStyle}>
                Company code (letters, numbers, hyphens; used as URL slug)
                <input
                  value={newCompanyCode}
                  onChange={(e) => setNewCompanyCode(e.target.value)}
                  style={inputStyle}
                  placeholder="acme-grow"
                  name="nb-new-company-code"
                />
              </label>
              <label style={labelStyle}>
                Owner email (receives invite)
                <input
                  value={newOwnerEmail}
                  onChange={(e) => setNewOwnerEmail(e.target.value)}
                  style={inputStyle}
                  type="email"
                  placeholder="owner@company.com"
                  name="nb-new-owner-email"
                />
              </label>
              <button
                type="submit"
                disabled={createBusy}
                style={{
                  marginTop: 4,
                  border: "none",
                  borderRadius: 12,
                  padding: "12px 16px",
                  background: createBusy ? "#475569" : "#f59e0b",
                  color: "white",
                  fontWeight: 900,
                  fontSize: 15,
                  cursor: createBusy ? "wait" : "pointer",
                }}
              >
                {createBusy ? "Creating…" : "Create workspace & send invite"}
              </button>
            </form>
          </section>
        )}
      </div>
    </main>
  );
}

export default function PortalSelectCompanyPage() {
  return (
    <Suspense
      fallback={
        <main
          style={{
            minHeight: "100vh",
            background:
              "radial-gradient(circle at top, #1e293b 0, #020617 45%, #000 100%)",
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <p style={{ color: "#93c5fd", fontWeight: 800 }}>Loading…</p>
        </main>
      }
    >
      <PortalBody />
    </Suspense>
  );
}
