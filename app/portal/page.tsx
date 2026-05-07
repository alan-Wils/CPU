"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  apiRequest,
  fetchCompanyUsageCosts,
  setSelectedCompanyId,
  syncVendorUsageCosts,
  type CompanyUsageCostsDto,
} from "@/lib/api";
import {
  canCreatePlatformCompanies,
  getAuthUser,
  isLoggedIn,
  isPortalSession,
  saveAuthSession,
  setPortalCompanies,
  type CpuCompany,
  type CpuUser,
} from "@/lib/auth";

type NexBatchInviteTier = "owner" | "nexbatch_admin" | "management" | "staff";
import { loadBackendStore } from "@/lib/backendStore";
import { formatCompanyTimestamp } from "@/lib/companyTimezone";

type NexBatchStaffRow = {
  id: string;
  email: string;
  platformRole: string;
  tier: NexBatchInviteTier;
  roleLabel: string;
  active: boolean;
  companiesGranted: number;
  createdAt: string;
};

function fmtUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

function UsageCostsModal({
  companyName,
  companyId,
  canSyncVendors,
  onClose,
}: {
  companyName: string;
  companyId: string;
  canSyncVendors: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<CompanyUsageCostsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState("");
  const [err, setErr] = useState("");

  const loadUsage = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);
    setErr("");
    try {
      const d = await fetchCompanyUsageCosts(companyId);
      setData(d);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not load usage and costs.");
    } finally {
      if (mode === "initial") setLoading(false);
      else setRefreshing(false);
    }
  }, [companyId]);

  useEffect(() => {
    void loadUsage("initial");
  }, [loadUsage]);

  const onSyncVendors = useCallback(async () => {
    if (!canSyncVendors) return;
    setSyncing(true);
    setSyncNote("");
    try {
      const out = await syncVendorUsageCosts();
      const connected = out.results.filter((r) => r.status === "connected").length;
      const missing = out.results.filter((r) => r.status === "missing_token").length;
      const failed = out.results.filter((r) => r.status === "sync_failed").length;
      setSyncNote(`Synced ${out.month}. Connected: ${connected}, Missing token: ${missing}, Failed: ${failed}.`);
      await loadUsage("refresh");
    } catch (e: unknown) {
      setSyncNote(e instanceof Error ? e.message : "Vendor sync failed.");
    } finally {
      setSyncing(false);
    }
  }, [canSyncVendors, loadUsage]);

  const onRefresh = useCallback(async () => {
    await loadUsage("refresh");
  }, [loadUsage]);

  const badgeForProviderStatus = useCallback((status: CompanyUsageCostsDto["providers"][number]["status"]) => {
    if (status === "connected") return { text: "Live vendor synced", color: "#22d3ee" };
    if (status === "missing_token") return { text: "Missing token", color: "#f97316" };
    if (status === "sync_failed") return { text: "Sync failed", color: "#f87171" };
    if (status === "unsupported") return { text: "Connected (unsupported billing endpoint)", color: "#a78bfa" };
    return { text: "Estimated from app usage", color: "#86efac" };
  }, []);

  const totalCost = data?.totalDisplayCost ?? 0;

  useEffect(() => {
    return () => {
      setSyncNote("");
    };
  }, []);

  const backdropStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.72)",
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    overflowY: "auto",
  };

  const panelStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 640,
    maxHeight: "90vh",
    overflowY: "auto",
    background: "rgba(15, 23, 42, 0.98)",
    border: "1px solid rgba(148, 163, 184, 0.35)",
    borderRadius: 16,
    padding: "22px 22px 26px",
    boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
    color: "#e2e8f0",
  };

  return (
    <div style={backdropStyle} role="presentation" onMouseDown={onClose}>
      <div style={panelStyle} role="dialog" aria-modal="true" aria-labelledby="usage-costs-title" onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
          <h2 id="usage-costs-title" style={{ margin: 0, fontSize: 22, fontWeight: 900, color: "#67e8f9", lineHeight: 1.25 }}>
            Usage & Costs — {companyName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              flexShrink: 0,
              border: "1px solid rgba(148,163,184,0.45)",
              borderRadius: 10,
              padding: "6px 12px",
              background: "#020617",
              color: "#94a3b8",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
        <p style={{ margin: "0 0 16px", color: "#64748b", fontSize: 13, lineHeight: 1.5 }}>
          Vendor totals are project-level; company values are allocated by each company&apos;s provider usage share unless exact per-company events exist.
        </p>
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={loading || refreshing || syncing}
            style={{
              border: "1px solid rgba(148,163,184,0.45)",
              borderRadius: 10,
              padding: "6px 12px",
              background: "#020617",
              color: "#cbd5e1",
              fontWeight: 700,
              cursor: loading || refreshing || syncing ? "wait" : "pointer",
            }}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          {canSyncVendors ? (
            <button
              type="button"
              onClick={() => void onSyncVendors()}
              disabled={loading || refreshing || syncing}
              style={{
                border: "1px solid rgba(34,197,94,0.5)",
                borderRadius: 10,
                padding: "6px 12px",
                background: "rgba(22, 163, 74, 0.2)",
                color: "#bbf7d0",
                fontWeight: 800,
                cursor: loading || refreshing || syncing ? "wait" : "pointer",
              }}
            >
              {syncing ? "Syncing vendor costs…" : "Sync vendor costs"}
            </button>
          ) : null}
        </div>
        {syncNote ? <p style={{ margin: "0 0 12px", color: "#93c5fd", fontSize: 12 }}>{syncNote}</p> : null}

        {loading ? (
          <p style={{ color: "#93c5fd", fontWeight: 700 }}>Loading usage…</p>
        ) : err ? (
          <div
            style={{
              padding: 12,
              borderRadius: 12,
              background: "rgba(127, 29, 29, 0.45)",
              border: "1px solid rgba(248, 113, 113, 0.45)",
              color: "#fecaca",
              fontWeight: 600,
            }}
          >
            {err}
          </div>
        ) : data ? (
          <>
            <div
              style={{
                display: "grid",
                gap: 12,
                marginBottom: 18,
                padding: 14,
                borderRadius: 12,
                border: "1px solid rgba(34, 211, 238, 0.35)",
                background: "#020617",
              }}
            >
              <div style={{ fontSize: 13, color: "#94a3b8", fontWeight: 700 }}>Current month ({data.monthLabel}, UTC)</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: "#f0f9ff" }}>
                Total MTD cost: {fmtUsd(totalCost)}
              </div>
              <div style={{ fontSize: 14, color: "#cbd5e1" }}>
                Projected month-end:{" "}
                <strong style={{ color: "#fcd34d" }}>
                  {data.projectedMonthlyCost != null ? fmtUsd(data.projectedMonthlyCost) : "— (need a few days of data)"}
                </strong>
              </div>
              <div style={{ fontSize: 12, color: "#64748b" }}>
                Last updated (latest event):{" "}
                {data.lastUpdated ? new Date(data.lastUpdated).toLocaleString() : "— No events this month"}
              </div>
            </div>

            <div style={{ fontSize: 13, fontWeight: 800, color: "#94a3b8", marginBottom: 10 }}>By provider</div>
            <div style={{ display: "grid", gap: 10 }}>
              {data.providers.map((p) => (
                <div
                  key={p.provider}
                  style={{
                    borderRadius: 12,
                    border: "1px solid rgba(51, 65, 85, 0.85)",
                    padding: "12px 14px",
                    background: "#0f172a",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                    <strong style={{ color: "#bae6fd", fontSize: 15 }}>{p.displayName}</strong>
                    <span style={{ color: "#fcd34d", fontWeight: 800 }}>{fmtUsd(p.displayCost ?? p.estimatedCost)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>{p.usageSummary}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 14px", marginBottom: 8 }}>
                    {p.usageMetrics.slice(0, 8).map((m) => (
                      <span key={m.label} style={{ fontSize: 12, color: "#cbd5e1" }}>
                        <span style={{ color: "#64748b" }}>{m.label}:</span> {m.value}
                      </span>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.45 }}>
                    <span style={{ color: badgeForProviderStatus(p.status).color, fontWeight: 700 }}>
                      {badgeForProviderStatus(p.status).text}
                    </span>
                    {p.lastSyncedAt ? (
                      <>
                        {" · "}Last synced {new Date(p.lastSyncedAt).toLocaleString()}
                      </>
                    ) : null}
                    {" · "}
                    {p.notes}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p style={{ color: "#64748b" }}>No data.</p>
        )}
      </div>
    </div>
  );
}

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

  const [staffEmail, setStaffEmail] = useState("");
  const [staffTier, setStaffTier] = useState<NexBatchInviteTier>("staff");
  const [staffBusy, setStaffBusy] = useState(false);
  const [staffErr, setStaffErr] = useState("");
  const [staffOk, setStaffOk] = useState<string | null>(null);
  const [staffRows, setStaffRows] = useState<NexBatchStaffRow[]>([]);
  const [staffListLoading, setStaffListLoading] = useState(false);
  const [staffListErr, setStaffListErr] = useState("");
  const [staffSavingId, setStaffSavingId] = useState<string | null>(null);
  const [staffEditById, setStaffEditById] = useState<
    Record<string, { tier: NexBatchInviteTier; active: boolean }>
  >({});
  const [usageCostsCompanyId, setUsageCostsCompanyId] = useState<string | null>(null);
  const [usageCostsCompanyName, setUsageCostsCompanyName] = useState("");

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

  const allowedTierOptions = (
    [
      ["staff", "NexBatch Staff"],
      ["management", "Management"],
      ["nexbatch_admin", "NexBatch Admin"],
      ["owner", "Owner (full platform)"],
    ] as const
  ).filter(([value]) =>
    value === "owner"
      ? String(getAuthUser()?.platformRole || "") === "owner"
      : true,
  );

  const fetchStaffRows = useCallback(async () => {
    if (!canCreate) return;
    setStaffListLoading(true);
    setStaffListErr("");
    try {
      const out = await apiRequest<{ staff: NexBatchStaffRow[] }>(
        "/api/nexbatch/staff",
        { omitCompanyHeader: true },
      );
      const rows = out.staff || [];
      setStaffRows(rows);
      setStaffEditById(
        rows.reduce(
          (acc, row) => {
            acc[row.id] = { tier: row.tier, active: row.active };
            return acc;
          },
          {} as Record<string, { tier: NexBatchInviteTier; active: boolean }>,
        ),
      );
    } catch (err: unknown) {
      setStaffListErr(
        err instanceof Error ? err.message : "Could not load NexBatch staff.",
      );
    } finally {
      setStaffListLoading(false);
    }
  }, [canCreate]);

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
        /** Always load from API — cached `cpu_portal_companies_json` skips new / invited tenants. */
        const list = await fetchAccessibleList();
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

  useEffect(() => {
    void fetchStaffRows();
  }, [fetchStaffRows]);

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

  async function onInviteStaff(e: React.FormEvent) {
    e.preventDefault();
    setStaffErr("");
    setStaffOk(null);

    const email = staffEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStaffErr("Enter a valid email.");
      return;
    }

    setStaffBusy(true);
    try {
      const out = await apiRequest<{
        email: string;
        platformRole: string;
        roleLabel: string;
        companiesGranted: number;
        expiresAt: string;
      }>("/api/nexbatch/staff/invite", {
        method: "POST",
        omitCompanyHeader: true,
        body: {
          email,
          tier: staffTier,
        },
      });
      setStaffOk(
        `Invitation sent to ${out.email} (${out.roleLabel}). They will open the link in the email, set a password, and land on the NexBatch portal with access to ${out.companiesGranted} workspace(s). Expires ${formatCompanyTimestamp(out.expiresAt)}.`,
      );
      setStaffEmail("");
      setStaffTier("staff");
      await fetchStaffRows();
    } catch (err: unknown) {
      setStaffErr(
        err instanceof Error ? err.message : "Could not send NexBatch staff invite.",
      );
    } finally {
      setStaffBusy(false);
    }
  }

  async function onSaveStaffRow(userId: string) {
    const edit = staffEditById[userId];
    if (!edit) return;
    setStaffSavingId(userId);
    setStaffErr("");
    setStaffOk(null);
    try {
      const out = await apiRequest<NexBatchStaffRow>(`/api/nexbatch/staff/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        omitCompanyHeader: true,
        body: {
          tier: edit.tier,
          active: edit.active,
        },
      });
      setStaffRows((prev) => prev.map((row) => (row.id === userId ? out : row)));
      setStaffEditById((prev) => ({
        ...prev,
        [userId]: { tier: out.tier, active: out.active },
      }));
      setStaffOk(`Updated ${out.email} to ${out.roleLabel}${out.active ? "" : " (inactive)"}.`);
    } catch (err: unknown) {
      setStaffErr(err instanceof Error ? err.message : "Could not update NexBatch staff member.");
    } finally {
      setStaffSavingId(null);
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
          maxWidth: canCreate ? 720 : 560,
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
                <div
                  style={{
                    borderRadius: 12,
                    border: "1px solid rgba(148, 163, 184, 0.35)",
                    background: "#020617",
                    overflow: "hidden",
                  }}
                >
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => onPick(c.id)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "16px 18px",
                      borderRadius: 0,
                      border: "none",
                      background: "transparent",
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
                  {canCreate ? (
                    <div
                      style={{
                        padding: "10px 14px",
                        borderTop: "1px solid rgba(148, 163, 184, 0.2)",
                        display: "flex",
                        justifyContent: "flex-end",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setUsageCostsCompanyId(c.id);
                          setUsageCostsCompanyName(c.name);
                        }}
                        style={{
                          border: "1px solid rgba(56, 189, 248, 0.55)",
                          borderRadius: 10,
                          padding: "8px 14px",
                          background: "rgba(14, 116, 144, 0.35)",
                          color: "#e0f2fe",
                          fontWeight: 800,
                          fontSize: 13,
                          cursor: "pointer",
                        }}
                      >
                        Usage & Costs
                      </button>
                    </div>
                  ) : null}
                </div>
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
              Invite NexBatch staff
            </h2>
            <p style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.55 }}>
              Sends an <strong style={{ color: "#cbd5e1" }}>email invite</strong> (same
              delivery as company user invites). They open the link, set a password, and sign
              in at the NexBatch portal with access to the{" "}
              <strong style={{ color: "#cbd5e1" }}>same company workspaces</strong> you see
              in the list above. You need at least one workspace in that list to grant access.
            </p>
            {staffOk && (
              <div
                style={{
                  marginTop: 14,
                  padding: 14,
                  borderRadius: 12,
                  background: "rgba(20, 83, 45, 0.45)",
                  border: "1px solid rgba(34, 197, 94, 0.45)",
                  color: "#bbf7d0",
                  fontSize: 14,
                  lineHeight: 1.55,
                }}
              >
                {staffOk}
              </div>
            )}
            {staffErr && (
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
                {staffErr}
              </div>
            )}
            <form
              onSubmit={onInviteStaff}
              style={{ marginTop: 16, display: "grid", gap: 14 }}
              autoComplete="off"
            >
              <label style={labelStyle}>
                Work email
                <input
                  value={staffEmail}
                  onChange={(e) => setStaffEmail(e.target.value)}
                  style={inputStyle}
                  type="email"
                  placeholder="colleague@nexbatch.com"
                  name="nb-staff-email"
                />
              </label>
              <label style={labelStyle}>
                NexBatch role
                <select
                  value={staffTier}
                  onChange={(e) =>
                    setStaffTier(e.target.value as NexBatchInviteTier)
                  }
                  style={{
                    ...inputStyle,
                    marginTop: 6,
                    cursor: "pointer",
                  }}
                  name="nb-staff-tier"
                >
                  {allowedTierOptions.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={staffBusy}
                style={{
                  marginTop: 4,
                  border: "none",
                  borderRadius: 12,
                  padding: "12px 16px",
                  background: staffBusy ? "#475569" : "#6366f1",
                  color: "white",
                  fontWeight: 900,
                  fontSize: 15,
                  cursor: staffBusy ? "wait" : "pointer",
                }}
              >
                {staffBusy ? "Sending…" : "Send invite email"}
              </button>
            </form>

            <div
              style={{
                marginTop: 24,
                paddingTop: 18,
                borderTop: "1px solid rgba(148, 163, 184, 0.2)",
              }}
            >
              <h3 style={{ margin: "0 0 10px", fontSize: 18, fontWeight: 800 }}>
                Current NexBatch staff
              </h3>
              {staffListErr ? (
                <p style={{ color: "#fca5a5", fontSize: 13, margin: "6px 0 10px" }}>
                  {staffListErr}
                </p>
              ) : null}
              {staffListLoading ? (
                <p style={{ color: "#94a3b8", fontSize: 13, margin: "6px 0 10px" }}>
                  Loading staff list…
                </p>
              ) : null}
              {!staffListLoading && staffRows.length === 0 ? (
                <p style={{ color: "#94a3b8", fontSize: 13, margin: "6px 0 10px" }}>
                  No NexBatch staff users yet.
                </p>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {staffRows.map((row) => {
                    const edit = staffEditById[row.id] || {
                      tier: row.tier,
                      active: row.active,
                    };
                    const saving = staffSavingId === row.id;
                    return (
                      <div
                        key={row.id}
                        style={{
                          border: "1px solid rgba(148, 163, 184, 0.28)",
                          borderRadius: 12,
                          padding: 12,
                          background: "#020617",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 10,
                            flexWrap: "wrap",
                          }}
                        >
                          <strong>{row.email}</strong>
                          <span style={{ color: row.active ? "#86efac" : "#fca5a5", fontSize: 12, fontWeight: 700 }}>
                            {row.active ? "ACTIVE" : "INACTIVE"}
                          </span>
                        </div>
                        <p style={{ margin: "6px 0 0", color: "#94a3b8", fontSize: 12 }}>
                          {row.companiesGranted} workspace(s) • Added {new Date(row.createdAt).toLocaleDateString()}
                        </p>
                        <div
                          style={{
                            marginTop: 10,
                            display: "grid",
                            gridTemplateColumns: "minmax(180px,1fr) auto auto",
                            gap: 10,
                            alignItems: "center",
                          }}
                        >
                          <select
                            value={edit.tier}
                            onChange={(e) =>
                              setStaffEditById((prev) => ({
                                ...prev,
                                [row.id]: {
                                  ...edit,
                                  tier: e.target.value as NexBatchInviteTier,
                                },
                              }))
                            }
                            style={{ ...inputStyle, marginTop: 0, padding: "8px 10px", fontSize: 14 }}
                            disabled={saving}
                          >
                            {allowedTierOptions.map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#cbd5e1" }}>
                            <input
                              type="checkbox"
                              checked={edit.active}
                              onChange={(e) =>
                                setStaffEditById((prev) => ({
                                  ...prev,
                                  [row.id]: {
                                    ...edit,
                                    active: e.target.checked,
                                  },
                                }))
                              }
                              disabled={saving}
                            />
                            Active
                          </label>
                          <button
                            type="button"
                            onClick={() => void onSaveStaffRow(row.id)}
                            disabled={saving}
                            style={{
                              border: "none",
                              borderRadius: 10,
                              padding: "8px 12px",
                              background: saving ? "#475569" : "#0ea5e9",
                              color: "white",
                              fontWeight: 800,
                              cursor: saving ? "wait" : "pointer",
                            }}
                          >
                            {saving ? "Saving…" : "Save"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        )}

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
      {usageCostsCompanyId ? (
        <UsageCostsModal
          companyId={usageCostsCompanyId}
          companyName={usageCostsCompanyName || "Company"}
          canSyncVendors={canCreate}
          onClose={() => {
            setUsageCostsCompanyId(null);
            setUsageCostsCompanyName("");
          }}
        />
      ) : null}
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
