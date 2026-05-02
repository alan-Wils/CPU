"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiRequest, setSelectedCompanyId } from "@/lib/api";
import {
  getPortalCompanies,
  isLoggedIn,
  isPortalSession,
  saveAuthSession,
  setPortalCompanies,
  type CpuCompany,
  type CpuUser,
} from "@/lib/auth";
import { loadBackendStore } from "@/lib/backendStore";

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

  useEffect(() => {
    let cancelled = false;

    async function loadList(): Promise<CpuCompany[]> {
      let list = getPortalCompanies();
      if (!list.length) {
        const raw = await apiRequest<{ companies: CpuCompany[] }>(
          "/api/companies/accessible",
          { omitCompanyHeader: true }
        );
        list = (raw.companies || []).map((c) => ({
          id: c.id,
          name: c.name,
          code: c.code || String((c as { slug?: string }).slug || "").toUpperCase(),
        }));
        setPortalCompanies(list);
      }
      return list;
    }

    async function run() {
      if (!isLoggedIn()) {
        router.replace("/login");
        return;
      }
      if (!isPortalSession()) {
        router.replace("/");
        return;
      }
      try {
        const list = await loadList();
        if (cancelled) return;
        if (list.length === 0) {
          setError("No companies are assigned to this account.");
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
  }, [router, searchParams]);

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
          maxWidth: 560,
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
          {companies.map((c) => (
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
                {c.name}{" "}
                <span style={{ color: "#64748b", fontWeight: 600 }}>
                  ({c.code})
                </span>
              </button>
            </li>
          ))}
        </ul>
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
