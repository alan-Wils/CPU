"use client";

import { Suspense, useCallback, useEffect, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  apiRequest,
  API_BASE_URL,
  clearSelectedCompanyId,
  deletePlatformCompany,
  fetchAdminVendorBillingSnapshots,
  fetchCompanyUsageCosts,
  fetchNexbatchCompanyUsageLog,
  getSelectedCompanyId,
  portalGetCompanyServices,
  portalPatchCompanyServices,
  postVendorBillingManualOverride,
  setSelectedCompanyId,
  syncVendorUsageCosts,
  type CompanyServicesDto,
  type CompanyUsageCostsDto,
  type NexbatchCompanyUsageLogItemDto,
} from "@/lib/api";
import {
  canCreatePlatformCompanies,
  canManageNexBatchPortalStaff,
  getAuthUser,
  isLoggedIn,
  isPortalSession,
  saveAuthSession,
  setPortalCompanies,
  type CpuCompany,
  type CpuUser,
} from "@/lib/auth";

type NexBatchInviteTier = "owner" | "nexbatch_admin" | "management" | "staff";
import TopBrandStrip from "@/components/TopBrandStrip";
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
  workspaceCompanyIds?: string[];
  createdAt: string;
};

type NexBatchPendingInviteRow = {
  id: string;
  email: string;
  platformRole: string;
  tier: NexBatchInviteTier;
  roleLabel: string;
  companiesGranted: number;
  expiresAt: string;
  invitedAt: string;
  status: "pending" | "expired";
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
  const [snapshots, setSnapshots] = useState<
    Awaited<ReturnType<typeof fetchAdminVendorBillingSnapshots>>["snapshots"]
  >([]);
  const [nexbatchLog, setNexbatchLog] = useState<NexbatchCompanyUsageLogItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState("");
  const [err, setErr] = useState("");
  const [manualUsd, setManualUsd] = useState("");
  const [manualProvider, setManualProvider] = useState<"neon" | "railway" | "vercel" | "resend" | "cloudflare_r2" | "ai">(
    "neon",
  );
  const [manualSaving, setManualSaving] = useState(false);
  const [manualNote, setManualNote] = useState("");

  const loadUsage = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);
    setErr("");
    try {
      const d = await fetchCompanyUsageCosts(companyId);
      const [logOut, snapOut] = await Promise.all([
        fetchNexbatchCompanyUsageLog(companyId, 35).catch(() => ({
          companyId,
          items: [] as NexbatchCompanyUsageLogItemDto[],
        })),
        fetchAdminVendorBillingSnapshots(d.monthLabel).catch(() => ({
          month: d.monthLabel,
          snapshots: [],
        })),
      ]);
      setData(d);
      setSnapshots(snapOut.snapshots);
      setNexbatchLog(logOut.items);
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
      const connected = out.results.filter((r) => r.status === "live_synced").length;
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

  const onManualSubmit = useCallback(async () => {
    if (!canSyncVendors) return;
    const n = Number.parseFloat(manualUsd);
    if (!Number.isFinite(n) || n < 0) {
      setManualNote("Enter a valid USD amount (e.g. 45.90).");
      return;
    }
    setManualSaving(true);
    setManualNote("");
    try {
      await postVendorBillingManualOverride({
        provider: manualProvider,
        month: data?.monthLabel,
        totalCostUsd: n,
        rawUsageJson: {
          manualEntry: true,
          notes: "Entered from NexBatch portal to match vendor dashboard MTD.",
        },
      });
      setManualNote("Saved vendor MTD override.");
      setManualUsd("");
      await loadUsage("refresh");
    } catch (e: unknown) {
      setManualNote(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setManualSaving(false);
    }
  }, [canSyncVendors, data?.monthLabel, manualProvider, manualUsd, loadUsage]);

  const badgeForProviderStatus = useCallback((status: CompanyUsageCostsDto["providers"][number]["status"]) => {
    if (status === "live_synced") return { text: "Live vendor synced", color: "#22d3ee" };
    if (status === "missing_token") return { text: "Missing token", color: "#f97316" };
    if (status === "sync_failed") return { text: "Sync failed", color: "#f87171" };
    if (status === "no_activity") return { text: "No activity", color: "#86efac" };
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

        {canSyncVendors ? (
          <div
            style={{
              marginBottom: 14,
              padding: 12,
              borderRadius: 12,
              border: "1px solid rgba(71, 85, 105, 0.75)",
              background: "#020617",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 800, color: "#94a3b8", marginBottom: 8 }}>Manual vendor MTD</div>
            <p style={{ margin: "0 0 10px", fontSize: 12, color: "#64748b", lineHeight: 1.45 }}>
              When a vendor does not expose invoice dollars via API (Neon consumption returns units only), enter the
              month-to-date total from the vendor billing page. This is stored as the authoritative vendor bill for
              allocation.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <label style={{ fontSize: 12, color: "#cbd5e1", display: "flex", flexDirection: "column", gap: 4 }}>
                Provider
                <select
                  value={manualProvider}
                  onChange={(e) =>
                    setManualProvider(e.target.value as typeof manualProvider)
                  }
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid rgba(148,163,184,0.45)",
                    background: "#0f172a",
                    color: "#e2e8f0",
                    fontWeight: 600,
                  }}
                >
                  <option value="neon">Neon Database</option>
                  <option value="railway">Railway Backend</option>
                  <option value="vercel">Vercel Frontend</option>
                  <option value="resend">Resend Email</option>
                  <option value="cloudflare_r2">Cloudflare R2</option>
                  <option value="ai">AI Data Analysis</option>
                </select>
              </label>
              <label style={{ fontSize: 12, color: "#cbd5e1", display: "flex", flexDirection: "column", gap: 4 }}>
                MTD USD
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={manualUsd}
                  onChange={(e) => setManualUsd(e.target.value)}
                  placeholder="e.g. 45.90"
                  style={{
                    width: 120,
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid rgba(148,163,184,0.45)",
                    background: "#0f172a",
                    color: "#e2e8f0",
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() => void onManualSubmit()}
                disabled={loading || refreshing || syncing || manualSaving}
                style={{
                  marginTop: 18,
                  border: "1px solid rgba(34,197,94,0.5)",
                  borderRadius: 10,
                  padding: "6px 12px",
                  background: "rgba(22, 163, 74, 0.2)",
                  color: "#bbf7d0",
                  fontWeight: 800,
                  cursor: loading || refreshing || syncing || manualSaving ? "wait" : "pointer",
                }}
              >
                {manualSaving ? "Saving…" : "Save manual MTD"}
              </button>
            </div>
            {manualNote ? <p style={{ margin: "10px 0 0", fontSize: 12, color: "#93c5fd" }}>{manualNote}</p> : null}
            {snapshots.length > 0 ? (
              <p style={{ margin: "10px 0 0", fontSize: 11, color: "#475569" }}>
                Stored snapshots this month: {snapshots.map((s) => `${s.provider} (${s.source})`).join(", ")}
              </p>
            ) : null}
          </div>
        ) : null}

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
                    <span style={{ color: "#fcd34d", fontWeight: 800 }}>{fmtUsd(p.allocatedCompanyCostUsd)}</span>
                  </div>
                  <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, color: "#64748b" }}>Vendor bill MTD</span>
                      <span style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 700, textAlign: "right", maxWidth: "72%" }}>
                        {p.vendorCostLineLabel}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, color: "#64748b" }}>Allocated to this workspace</span>
                      <span style={{ fontSize: 12, color: "#fcd34d", fontWeight: 800 }}>{fmtUsd(p.allocatedCompanyCostUsd)}</span>
                    </div>
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

            <div style={{ marginTop: 22 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#94a3b8", marginBottom: 8 }}>
                NexBatch platform usage (attributed here)
              </div>
              <p style={{ margin: "0 0 10px", fontSize: 12, color: "#64748b", lineHeight: 1.45 }}>
                Actions initiated by NexBatch staff (for example inviting staff attached to multiple companies) are logged per company — often split as fractional units across each attached tenant so totals stay proportional.
              </p>
              {nexbatchLog.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12, color: "#475569", fontStyle: "italic" }}>No NexBatch-attributed rows for this workspace yet.</p>
              ) : (
                <div style={{ display: "grid", gap: 8, maxHeight: 220, overflowY: "auto" }}>
                  {nexbatchLog.map((row) => (
                    <div
                      key={row.id}
                      style={{
                        fontSize: 11,
                        lineHeight: 1.45,
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid rgba(71, 85, 105, 0.6)",
                        background: "#020617",
                      }}
                    >
                      <div style={{ color: "#bae6fd", fontWeight: 700 }}>
                        {row.feature} · {row.provider} · {row.unitType}: {Number.isFinite(row.units) ? Number(row.units).toFixed(row.units >= 1 ? 4 : 6) : "0"}
                      </div>
                      <div style={{ color: "#64748b" }}>
                        {new Date(row.createdAt).toLocaleString()}
                        {" · "}est. {fmtUsd(row.estimatedCost)}
                      </div>
                      {typeof row.category === "string" && row.category ? (
                        <div style={{ color: "#57534e" }}>category: {row.category}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <p style={{ color: "#64748b" }}>No data.</p>
        )}
      </div>
    </div>
  );
}

function WorkspaceServicesModal({
  companyName,
  companyId,
  onClose,
}: {
  companyName: string;
  companyId: string;
  onClose: () => void;
}) {
  const [services, setServices] = useState<CompanyServicesDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [savingKey, setSavingKey] = useState<string>("");
  const [okNote, setOkNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const out = await portalGetCompanyServices(companyId);
      setServices(out.services);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not load workspace services.");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchField = useCallback(async (patch: Partial<CompanyServicesDto>) => {
    setSavingKey(Object.keys(patch).join(","));
    setErr("");
    setOkNote("");
    try {
      const out = await portalPatchCompanyServices(companyId, patch);
      setServices(out.services);
      setOkNote("Saved.");
      setTimeout(() => setOkNote(""), 2200);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSavingKey("");
    }
  }, [companyId]);

  const backdropStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.72)",
    zIndex: 1100,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    overflowY: "auto",
  };

  const panelStyle: CSSProperties = {
    width: "100%",
    maxWidth: 520,
    maxHeight: "90vh",
    overflowY: "auto",
    background: "rgba(15, 23, 42, 0.98)",
    border: "1px solid rgba(148, 163, 184, 0.35)",
    borderRadius: 16,
    padding: "22px 22px 26px",
    boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
    color: "#e2e8f0",
  };

  const row = (label: string, description: string, on: boolean, busy: boolean, onToggle: () => void) => (
    <div
      style={{
        padding: "14px 0",
        borderBottom: "1px solid rgba(148, 163, 184, 0.15)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, color: "#f8fafc" }}>{label}</div>
          <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4, maxWidth: 400, lineHeight: 1.45 }}>{description}</div>
        </div>
        <button
          type="button"
          disabled={busy || loading || !services}
          onClick={() => void onToggle()}
          style={{
            minWidth: 72,
            padding: "10px 16px",
            borderRadius: 12,
            border: on ? "1px solid rgba(34, 197, 94, 0.55)" : "1px solid rgba(148, 163, 184, 0.45)",
            background: on ? "rgba(22, 163, 74, 0.35)" : "#020617",
            color: on ? "#bbf7d0" : "#94a3b8",
            fontWeight: 800,
            fontSize: 14,
            cursor: busy || loading || !services ? "wait" : "pointer",
          }}
        >
          {busy ? "…" : on ? "On" : "Off"}
        </button>
      </div>
    </div>
  );

  return (
    <div style={backdropStyle} role="presentation" onMouseDown={onClose}>
      <div style={panelStyle} role="dialog" aria-modal="true" aria-labelledby="ws-services-title" onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
          <h2 id="ws-services-title" style={{ margin: 0, fontSize: 22, fontWeight: 900, color: "#a78bfa", lineHeight: 1.25 }}>
            Workspace services — {companyName}
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
          Controls which NexBatch modules this workspace can use. Changes apply after each successful save.
        </p>
        {loading ? (
          <p style={{ color: "#93c5fd", fontWeight: 700 }}>Loading…</p>
        ) : err && !services ? (
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
        ) : services ? (
          <>
            {err ? (
              <div
                style={{
                  marginBottom: 12,
                  padding: 10,
                  borderRadius: 10,
                  background: "rgba(127, 29, 29, 0.35)",
                  border: "1px solid rgba(248, 113, 113, 0.4)",
                  color: "#fecaca",
                  fontSize: 13,
                }}
              >
                {err}
              </div>
            ) : null}
            {okNote ? (
              <p style={{ margin: "0 0 12px", color: "#86efac", fontSize: 13, fontWeight: 700 }}>{okNote}</p>
            ) : null}
            {row(
              "Production",
              "Enables cultivation, extraction, and packaging production workflow for this workspace.",
              services.productionEnabled,
              savingKey === "productionEnabled",
              () => void patchField({ productionEnabled: !services.productionEnabled }),
            )}
            {row(
              "Sales Platform — Seller Side",
              "Lets this company list products for sale in the NexBatch marketplace.",
              services.salesSellerEnabled,
              savingKey === "salesSellerEnabled",
              () => void patchField({ salesSellerEnabled: !services.salesSellerEnabled }),
            )}
            {row(
              "Sales Platform — Buyer Side",
              "Lets this company browse and buy from other seller companies.",
              services.salesBuyerEnabled,
              savingKey === "salesBuyerEnabled",
              () => void patchField({ salesBuyerEnabled: !services.salesBuyerEnabled }),
            )}
            {services.salesSellerEnabled
              ? row(
                  "LeafLink Inventory Sync",
                  "Imports LeafLink inventory into seller marketplace products (requires LeafLink configured for the tenant).",
                  services.leafLinkInventorySyncEnabled,
                  savingKey === "leafLinkInventorySyncEnabled",
                  () =>
                    void patchField({
                      leafLinkInventorySyncEnabled: !services.leafLinkInventorySyncEnabled,
                    }),
                )
              : null}
          </>
        ) : null}
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
  /** Initial CompanyServiceSettings for the new tenant (same flags as Workspace services modal). */
  const [newWsProduction, setNewWsProduction] = useState(false);
  const [newWsSeller, setNewWsSeller] = useState(false);
  const [newWsBuyer, setNewWsBuyer] = useState(false);
  const [newWsLeafLinkSync, setNewWsLeafLinkSync] = useState(false);
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
  const [pendingInvites, setPendingInvites] = useState<NexBatchPendingInviteRow[]>([]);
  const [staffListLoading, setStaffListLoading] = useState(false);
  const [staffListErr, setStaffListErr] = useState("");
  const [staffSavingId, setStaffSavingId] = useState<string | null>(null);
  const [revokingInviteId, setRevokingInviteId] = useState<string | null>(null);
  const [staffEditById, setStaffEditById] = useState<
    Record<string, { tier: NexBatchInviteTier; active: boolean }>
  >({});
  const [usageCostsCompanyId, setUsageCostsCompanyId] = useState<string | null>(null);
  const [usageCostsCompanyName, setUsageCostsCompanyName] = useState("");
  const [servicesCompanyId, setServicesCompanyId] = useState<string | null>(null);
  const [servicesCompanyName, setServicesCompanyName] = useState("");
  const [inviteCompanySelection, setInviteCompanySelection] = useState<string[]>([]);
  /** NexBatch Owner / NexBatch Admin — hard-delete workspace after confirmation. */
  const [companyToDelete, setCompanyToDelete] = useState<CpuCompany | null>(null);
  const [deleteCompanyBusy, setDeleteCompanyBusy] = useState(false);
  const [deleteCompanyErr, setDeleteCompanyErr] = useState("");
  const [workspaceEditUserId, setWorkspaceEditUserId] = useState<string | null>(null);
  const [workspaceSelection, setWorkspaceSelection] = useState<string[]>([]);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);

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
  const canManageStaff = canManageNexBatchPortalStaff();

  const platformPr = String(getAuthUser()?.platformRole || "").trim();
  const allowedTierOptions = (
    [
      ["staff", "NexBatch Staff"],
      ["management", "Management"],
      ["nexbatch_admin", "NexBatch Admin"],
      ["owner", "Owner (full platform)"],
    ] as const
  ).filter(([value]) => {
    if (value === "owner") return platformPr === "owner";
    if (platformPr === "admin") {
      return value === "nexbatch_admin" || value === "staff";
    }
    return true;
  });

  useEffect(() => {
    if (!companies.length) {
      setInviteCompanySelection([]);
      return;
    }
    setInviteCompanySelection(companies.map((c) => c.id));
  }, [companies]);

  const fetchStaffRows = useCallback(async () => {
    if (!canManageStaff) return;
    setStaffListLoading(true);
    setStaffListErr("");
    try {
      const out = await apiRequest<{
        staff: NexBatchStaffRow[];
        pendingInvites?: NexBatchPendingInviteRow[];
      }>("/api/nexbatch/staff", { omitCompanyHeader: true });
      const rows = out.staff || [];
      setStaffRows(rows);
      setPendingInvites(Array.isArray(out.pendingInvites) ? out.pendingInvites : []);
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
  }, [canManageStaff]);

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

  async function confirmDeleteCompany() {
    const target = companyToDelete;
    if (!target || deleteCompanyBusy) return;
    setDeleteCompanyErr("");
    setDeleteCompanyBusy(true);
    try {
      await deletePlatformCompany(target.id);
      if (getSelectedCompanyId() === target.id) {
        clearSelectedCompanyId();
      }
      setCompanyToDelete(null);
      setInviteCompanySelection((prev) => prev.filter((id) => id !== target.id));
      if (usageCostsCompanyId === target.id) {
        setUsageCostsCompanyId(null);
        setUsageCostsCompanyName("");
      }
      const list = await fetchAccessibleList();
      setCompanies(list);
      if (canManageStaff) void fetchStaffRows();
    } catch (err: unknown) {
      setDeleteCompanyErr(
        err instanceof Error ? err.message : "Could not delete company.",
      );
    } finally {
      setDeleteCompanyBusy(false);
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
          workspaceServices: {
            productionEnabled: newWsProduction,
            salesSellerEnabled: newWsSeller,
            salesBuyerEnabled: newWsBuyer,
            leafLinkInventorySyncEnabled: newWsSeller && newWsLeafLinkSync,
          },
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
      setNewWsProduction(false);
      setNewWsSeller(false);
      setNewWsBuyer(false);
      setNewWsLeafLinkSync(false);
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
    if (!inviteCompanySelection.length) {
      setStaffErr("Select at least one workspace to grant.");
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
          companyIds: inviteCompanySelection,
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

  async function onRevokePendingInvite(inviteId: string) {
    setRevokingInviteId(inviteId);
    setStaffErr("");
    setStaffOk(null);
    try {
      await apiRequest<{ ok: boolean }>(`/api/nexbatch/staff/invites/${encodeURIComponent(inviteId)}`, {
        method: "DELETE",
        omitCompanyHeader: true,
      });
      setStaffOk("Invitation revoked — the link in the email will no longer work.");
      await fetchStaffRows();
    } catch (err: unknown) {
      setStaffErr(err instanceof Error ? err.message : "Could not revoke invitation.");
    } finally {
      setRevokingInviteId(null);
    }
  }

  async function onSaveStaffRow(userId: string) {
    const edit = staffEditById[userId];
    if (!edit) return;
    setStaffSavingId(userId);
    setStaffErr("");
    setStaffOk(null);
    try {
      const out = await apiRequest<NexBatchStaffRow>(
        `/api/nexbatch/staff/${encodeURIComponent(userId)}`,
        {
          method: "PATCH",
          omitCompanyHeader: true,
          body: {
            tier: edit.tier,
            active: edit.active,
          },
        },
      );
      const merged =
        typeof out.workspaceCompanyIds === "undefined"
          ? { ...out, workspaceCompanyIds: staffRows.find((r) => r.id === userId)?.workspaceCompanyIds }
          : out;
      setStaffRows((prev) => prev.map((row) => (row.id === userId ? merged : row)));
      setStaffEditById((prev) => ({
        ...prev,
        [userId]: { tier: merged.tier, active: merged.active },
      }));
      setStaffOk(`Updated ${merged.email} to ${merged.roleLabel}${merged.active ? "" : " (inactive)"}.`);
    } catch (err: unknown) {
      setStaffErr(err instanceof Error ? err.message : "Could not update NexBatch staff member.");
    } finally {
      setStaffSavingId(null);
    }
  }

  function openWorkspaceEditor(row: NexBatchStaffRow) {
    setStaffErr("");
    setStaffOk(null);
    setWorkspaceEditUserId(row.id);
    setWorkspaceSelection([...(row.workspaceCompanyIds ?? [])]);
  }

  async function onSaveWorkspaceAccess() {
    if (!workspaceEditUserId) return;
    const row = staffRows.find((r) => r.id === workspaceEditUserId);
    const prev = new Set(row?.workspaceCompanyIds ?? []);
    const nextSet = new Set(workspaceSelection);
    const add = [...nextSet].filter((id) => !prev.has(id));
    const remove = [...prev].filter((id) => !nextSet.has(id));
    if (!add.length && !remove.length) {
      setStaffOk("No workspace changes.");
      setWorkspaceEditUserId(null);
      return;
    }
    setWorkspaceBusy(true);
    setStaffErr("");
    setStaffOk(null);
    try {
      await apiRequest<{ ok: boolean; memberships: number }>(
        `/api/nexbatch/staff/${encodeURIComponent(workspaceEditUserId)}/company-access`,
        {
          method: "POST",
          omitCompanyHeader: true,
          body: { add, remove },
        },
      );
      setStaffOk(`${row?.email ?? "User"} workspaces updated (${nextSet.size} total).`);
      setWorkspaceEditUserId(null);
      await fetchStaffRows();
    } catch (err: unknown) {
      setStaffErr(err instanceof Error ? err.message : "Could not update workspaces.");
    } finally {
      setWorkspaceBusy(false);
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
          flexDirection: "column",
          alignItems: "stretch",
        }}
      >
        <div
          style={{
            padding: "16px 24px 0",
            maxWidth: 720,
            margin: "0 auto",
            width: "100%",
            boxSizing: "border-box",
          }}
        >
          <TopBrandStrip apiBaseUrl={API_BASE_URL} linkNexbatchToHome={false} />
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <p style={{ color: "#93c5fd", fontWeight: 800 }}>Loading companies…</p>
        </div>
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
        flexDirection: "column",
        alignItems: "stretch",
      }}
    >
      <div
        style={{
          padding: "16px 24px 0",
          maxWidth: canCreate ? 720 : 560,
          margin: "0 auto",
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        <TopBrandStrip apiBaseUrl={API_BASE_URL} linkNexbatchToHome={false} />
      </div>
      <div
        style={{
          flex: 1,
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
                        flexWrap: "wrap",
                        gap: 10,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setServicesCompanyId(c.id);
                          setServicesCompanyName(c.name);
                        }}
                        style={{
                          border: "1px solid rgba(167, 139, 250, 0.55)",
                          borderRadius: 10,
                          padding: "8px 14px",
                          background: "rgba(91, 33, 182, 0.35)",
                          color: "#e9d5ff",
                          fontWeight: 800,
                          fontSize: 13,
                          cursor: "pointer",
                        }}
                      >
                        Workspace services
                      </button>
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
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteCompanyErr("");
                          setCompanyToDelete(c);
                        }}
                        style={{
                          border: "1px solid rgba(248, 113, 113, 0.55)",
                          borderRadius: 10,
                          padding: "8px 14px",
                          background: "rgba(127, 29, 29, 0.45)",
                          color: "#fecaca",
                          fontWeight: 800,
                          fontSize: 13,
                          cursor: "pointer",
                        }}
                      >
                        Delete workspace
                      </button>
                    </div>
                  ) : null}
                </div>
              </li>
            ))
          )}
        </ul>

        {companyToDelete ? (
          <div
            role="presentation"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 1200,
              background: "rgba(0,0,0,0.72)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
            }}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget && !deleteCompanyBusy) {
                setCompanyToDelete(null);
                setDeleteCompanyErr("");
              }
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-company-title"
              style={{
                width: "100%",
                maxWidth: 440,
                background: "#0f172a",
                border: "1px solid rgba(248, 113, 113, 0.45)",
                borderRadius: 16,
                padding: "24px 26px",
                boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <h2
                id="delete-company-title"
                style={{ marginTop: 0, marginBottom: 12, fontSize: 22, fontWeight: 900 }}
              >
                Delete company?
              </h2>
              <p style={{ color: "#fecaca", lineHeight: 1.55, margin: "0 0 8px" }}>
                Are you sure you want to delete{" "}
                <strong style={{ color: "#fff" }}>{companyToDelete.name}</strong> (
                {companyToDelete.code})?
              </p>
              <p style={{ color: "#94a3b8", lineHeight: 1.55, margin: "0 0 18px" }}>
                All data for this workspace will be permanently lost. This cannot be undone.
              </p>
              {deleteCompanyErr ? (
                <div
                  style={{
                    marginBottom: 14,
                    padding: 12,
                    borderRadius: 10,
                    background: "rgba(127, 29, 29, 0.55)",
                    border: "1px solid rgba(248, 113, 113, 0.45)",
                    color: "#fecaca",
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  {deleteCompanyErr}
                </div>
              ) : null}
              <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button
                  type="button"
                  disabled={deleteCompanyBusy}
                  onClick={() => {
                    if (!deleteCompanyBusy) {
                      setCompanyToDelete(null);
                      setDeleteCompanyErr("");
                    }
                  }}
                  style={{
                    border: "1px solid rgba(148, 163, 184, 0.45)",
                    borderRadius: 10,
                    padding: "10px 16px",
                    background: "transparent",
                    color: "#e2e8f0",
                    fontWeight: 800,
                    cursor: deleteCompanyBusy ? "wait" : "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleteCompanyBusy}
                  onClick={() => void confirmDeleteCompany()}
                  style={{
                    border: "none",
                    borderRadius: 10,
                    padding: "10px 16px",
                    background: deleteCompanyBusy ? "#64748b" : "#dc2626",
                    color: "white",
                    fontWeight: 900,
                    cursor: deleteCompanyBusy ? "wait" : "pointer",
                  }}
                >
                  {deleteCompanyBusy ? "Deleting…" : "Yes, delete forever"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {canManageStaff && (
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
              <strong style={{ color: "#cbd5e1" }}>workspaces you select below</strong> (defaults
              to all workspaces you can see). Owner and NexBatch Admin can invite every role;
              NexBatch Staff managers may only invite <strong style={{ color: "#cbd5e1" }}>NexBatch Admin</strong>{" "}
              or <strong style={{ color: "#cbd5e1" }}>NexBatch Staff</strong>.
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
              {companies.length > 0 ? (
                <div style={{ marginTop: 4 }}>
                  <span style={labelStyle}>Workspaces to grant</span>
                  <div
                    style={{
                      maxHeight: 220,
                      overflowY: "auto",
                      border: "1px solid rgba(148, 163, 184, 0.28)",
                      borderRadius: 10,
                      padding: 10,
                      background: "#020617",
                    }}
                  >
                    <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, cursor: "pointer", fontWeight: 600 }}>
                      <input
                        type="checkbox"
                        checked={
                          inviteCompanySelection.length === companies.length &&
                          companies.length > 0
                        }
                        onChange={(e) => {
                          if (e.target.checked) {
                            setInviteCompanySelection(companies.map((c) => c.id));
                          } else {
                            setInviteCompanySelection([]);
                          }
                        }}
                      />
                      <span style={{ color: "#cbd5e1", fontSize: 13 }}>
                        Select all ({companies.length})
                      </span>
                    </label>
                    <div style={{ display: "grid", gap: 6 }}>
                      {companies.map((c) => {
                        const sel = inviteCompanySelection.includes(c.id);
                        return (
                          <label
                            key={c.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              cursor: "pointer",
                              fontSize: 13,
                              color: "#e2e8f0",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={sel}
                              onChange={() => {
                                setInviteCompanySelection((prev) =>
                                  sel ? prev.filter((id) => id !== c.id) : [...prev, c.id],
                                );
                              }}
                            />
                            <span>
                              {c.name}{" "}
                              <span style={{ color: "#64748b" }}>({c.code})</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null}
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
                Pending invitations
              </h3>
              {staffListErr ? (
                <p style={{ color: "#fca5a5", fontSize: 13, margin: "6px 0 10px" }}>
                  {staffListErr}
                </p>
              ) : null}
              {staffListLoading ? (
                <p style={{ color: "#94a3b8", fontSize: 13, margin: "6px 0 10px" }}>
                  Loading…
                </p>
              ) : pendingInvites.length === 0 ? (
                <p style={{ color: "#64748b", fontSize: 13, margin: "6px 0 14px", fontStyle: "italic" }}>
                  No pending NexBatch staff invitations.
                </p>
              ) : (
                <div style={{ display: "grid", gap: 10, marginBottom: 18 }}>
                  {pendingInvites.map((inv) => {
                    const revoking = revokingInviteId === inv.id;
                    const expired = inv.status === "expired";
                    return (
                      <div
                        key={inv.id}
                        style={{
                          border: `1px solid ${expired ? "rgba(251, 191, 36, 0.45)" : "rgba(56, 189, 248, 0.4)"}`,
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
                            alignItems: "center",
                          }}
                        >
                          <strong>{inv.email}</strong>
                          <span
                            style={{
                              color: expired ? "#fdba74" : "#7dd3fc",
                              fontSize: 12,
                              fontWeight: 800,
                            }}
                          >
                            {expired ? "EXPIRED (not accepted)" : "INVITED"}
                          </span>
                        </div>
                        <p style={{ margin: "6px 0 0", color: "#94a3b8", fontSize: 12 }}>
                          {inv.roleLabel} · {inv.companiesGranted} workspace(s) · Sent{" "}
                          {new Date(inv.invitedAt).toLocaleString()} · Expires{" "}
                          {formatCompanyTimestamp(inv.expiresAt)}
                        </p>
                        <button
                          type="button"
                          onClick={() => void onRevokePendingInvite(inv.id)}
                          disabled={revoking}
                          style={{
                            marginTop: 10,
                            border: "1px solid rgba(248, 113, 113, 0.5)",
                            borderRadius: 10,
                            padding: "8px 12px",
                            background: revoking ? "#475569" : "rgba(127, 29, 29, 0.35)",
                            color: "#fecaca",
                            fontWeight: 800,
                            fontSize: 13,
                            cursor: revoking ? "wait" : "pointer",
                          }}
                        >
                          {revoking ? "Revoking…" : "Revoke invitation"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <h3 style={{ margin: "18px 0 10px", fontSize: 18, fontWeight: 800 }}>
                Active NexBatch staff
              </h3>
              {!staffListLoading && staffRows.length === 0 ? (
                <p style={{ color: "#94a3b8", fontSize: 13, margin: "6px 0 10px" }}>
                  No active NexBatch staff accounts yet (they appear after the invite is accepted).
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
                        <button
                          type="button"
                          onClick={() => openWorkspaceEditor(row)}
                          disabled={saving || workspaceBusy}
                          style={{
                            marginTop: 10,
                            border: "1px solid rgba(148,163,184,0.45)",
                            borderRadius: 10,
                            padding: "8px 12px",
                            background: "#020617",
                            color: "#e2e8f0",
                            fontWeight: 700,
                            fontSize: 13,
                            cursor: saving ? "wait" : "pointer",
                          }}
                        >
                          Workspaces…
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        )}

        {canManageStaff && workspaceEditUserId ? (
          <div
            role="presentation"
            onMouseDown={() => {
              if (!workspaceBusy) setWorkspaceEditUserId(null);
            }}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.72)",
              zIndex: 1100,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 16,
              overflowY: "auto",
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                width: "100%",
                maxWidth: 520,
                maxHeight: "90vh",
                overflowY: "auto",
                background: "rgba(15, 23, 42, 0.98)",
                border: "1px solid rgba(148, 163, 184, 0.35)",
                borderRadius: 16,
                padding: "22px 22px 26px",
                boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
                color: "#e2e8f0",
              }}
            >
              <h3 style={{ margin: "0 0 12px", fontSize: 20, fontWeight: 900, color: "#67e8f9" }}>
                Workspaces — {staffRows.find((r) => r.id === workspaceEditUserId)?.email ?? workspaceEditUserId}
              </h3>
              <p style={{ margin: "0 0 14px", fontSize: 13, color: "#94a3b8", lineHeight: 1.55 }}>
                Add or remove company access for this NexBatch portal account (they must keep at least one workspace).
              </p>
              <div
                style={{
                  maxHeight: 280,
                  overflowY: "auto",
                  border: "1px solid rgba(148, 163, 184, 0.28)",
                  borderRadius: 10,
                  padding: 12,
                  background: "#020617",
                  display: "grid",
                  gap: 8,
                }}
              >
                {[
                  ...new Set([
                    ...companies.map((c) => c.id),
                    ...workspaceSelection,
                  ]),
                ].map((id) => {
                  const nm = companies.find((c) => c.id === id);
                  const label = nm ? `${nm.name} (${nm.code})` : `Workspace (${id.slice(0, 8)}…)`;
                  const checked = workspaceSelection.includes(id);
                  return (
                    <label
                      key={id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setWorkspaceSelection((prev) =>
                            checked ? prev.filter((x) => x !== id) : [...prev, id],
                          )
                        }
                        disabled={workspaceBusy}
                      />
                      <span>{label}</span>
                    </label>
                  );
                })}
              </div>
              <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  disabled={workspaceBusy}
                  onClick={() => void onSaveWorkspaceAccess()}
                  style={{
                    border: "none",
                    borderRadius: 10,
                    padding: "10px 16px",
                    background: workspaceBusy ? "#475569" : "#22c55e",
                    color: "white",
                    fontWeight: 800,
                    cursor: workspaceBusy ? "wait" : "pointer",
                  }}
                >
                  {workspaceBusy ? "Saving…" : "Apply changes"}
                </button>
                <button
                  type="button"
                  disabled={workspaceBusy}
                  onClick={() => setWorkspaceEditUserId(null)}
                  style={{
                    border: "1px solid rgba(148,163,184,0.45)",
                    borderRadius: 10,
                    padding: "10px 16px",
                    background: "#020617",
                    color: "#94a3b8",
                    fontWeight: 700,
                    cursor: workspaceBusy ? "wait" : "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}

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

              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: 12,
                  border: "1px solid rgba(148, 163, 184, 0.25)",
                  background: "rgba(15, 23, 42, 0.65)",
                }}
              >
                <div style={{ fontWeight: 800, fontSize: 14, color: "#e2e8f0", marginBottom: 6 }}>
                  Workspace modules (initial)
                </div>
                <p style={{ margin: "0 0 12px", color: "#64748b", fontSize: 13, lineHeight: 1.5 }}>
                  Same toggles as Workspace services on an existing company. You can change these anytime after the
                  tenant is created.
                </p>
                {(
                  [
                    [
                      "production",
                      "Production",
                      "Cultivation, extraction, and packaging workflows.",
                      newWsProduction,
                      (v: boolean) => setNewWsProduction(v),
                    ],
                    [
                      "seller",
                      "Sales Platform — Seller Side",
                      "List products on the NexBatch marketplace.",
                      newWsSeller,
                      (v: boolean) => {
                        setNewWsSeller(v);
                        if (!v) setNewWsLeafLinkSync(false);
                      },
                    ],
                    [
                      "buyer",
                      "Sales Platform — Buyer Side",
                      "Browse and purchase from other sellers.",
                      newWsBuyer,
                      (v: boolean) => setNewWsBuyer(v),
                    ],
                  ] as const
                ).map(([key, title, desc, checked, setChecked]) => (
                  <label
                    key={key}
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "flex-start",
                      cursor: "pointer",
                      marginBottom: 10,
                      fontSize: 13,
                      color: "#cbd5e1",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setChecked(e.target.checked)}
                      disabled={createBusy}
                      style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0 }}
                    />
                    <span>
                      <span style={{ fontWeight: 800, color: "#f8fafc" }}>{title}</span>
                      <span style={{ display: "block", color: "#94a3b8", marginTop: 2, lineHeight: 1.45 }}>
                        {desc}
                      </span>
                    </span>
                  </label>
                ))}
                <label
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                    cursor: newWsSeller ? "pointer" : "not-allowed",
                    marginBottom: 0,
                    fontSize: 13,
                    color: newWsSeller ? "#cbd5e1" : "#64748b",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={newWsSeller && newWsLeafLinkSync}
                    onChange={(e) => setNewWsLeafLinkSync(e.target.checked)}
                    disabled={createBusy || !newWsSeller}
                    style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0 }}
                  />
                  <span>
                    <span style={{ fontWeight: 800, color: newWsSeller ? "#f8fafc" : "#64748b" }}>
                      LeafLink Inventory Sync
                    </span>
                    <span style={{ display: "block", color: "#94a3b8", marginTop: 2, lineHeight: 1.45 }}>
                      Imports LeafLink inventory into seller marketplace products (requires Seller Side and LeafLink
                      configured for the tenant).
                    </span>
                  </span>
                </label>
              </div>

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
      {servicesCompanyId ? (
        <WorkspaceServicesModal
          companyId={servicesCompanyId}
          companyName={servicesCompanyName || "Company"}
          onClose={() => {
            setServicesCompanyId(null);
            setServicesCompanyName("");
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
            flexDirection: "column",
            alignItems: "stretch",
          }}
        >
          <div
            style={{
              padding: "16px 24px 0",
              maxWidth: 720,
              margin: "0 auto",
              width: "100%",
              boxSizing: "border-box",
            }}
          >
            <TopBrandStrip apiBaseUrl={API_BASE_URL} linkNexbatchToHome={false} />
          </div>
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
            }}
          >
            <p style={{ color: "#93c5fd", fontWeight: 800 }}>Loading…</p>
          </div>
        </main>
      }
    >
      <PortalBody />
    </Suspense>
  );
}
