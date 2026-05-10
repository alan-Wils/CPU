"use client";

import { useCallback, useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { AnalyticsOverviewJson } from "@/lib/analyticsOverviewApi";
import {
  loadAnalyticsDashboardPrefs,
  saveAnalyticsDashboardPrefs,
  type AnalyticsSectionKey,
} from "@/lib/analyticsDashboardPrefs";

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(2)}K`;
  return `$${n.toFixed(0)}`;
}

function pctStr(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function trendLine(t: { pct: number; up: boolean } | null | undefined): { text: string; up: boolean | null } {
  if (!t || !Number.isFinite(t.pct)) return { text: "—", up: null };
  const arrow = t.up ? "↑" : "↓";
  return { text: `${arrow} ${Math.abs(t.pct).toFixed(1)}%`, up: t.up };
}

function pick(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const p of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function KpiCard(props: {
  title: string;
  value: string;
  sub?: string;
  trend?: string;
  trendUp?: boolean | null;
  icon?: string;
}) {
  const trendColor =
    props.trendUp === null || props.trendUp === undefined
      ? "#94a3b8"
      : props.trendUp
        ? "#86efac"
        : "#fca5a5";
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      whileHover={{ borderColor: "rgba(34,197,94,0.35)", boxShadow: "0 0 0 1px rgba(34,197,94,0.12), 0 14px 32px rgba(0,0,0,0.4)" }}
      style={{
        background: "linear-gradient(145deg, rgba(15,23,42,0.95), rgba(2,6,23,0.98))",
        border: "1px solid rgba(51,65,85,0.85)",
        borderRadius: 14,
        padding: "14px 16px",
        boxShadow: "0 0 0 1px rgba(34,197,94,0.06), 0 12px 28px rgba(0,0,0,0.35)",
        minHeight: 108,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        transition: "border-color 0.2s, box-shadow 0.2s",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <span style={{ color: "#94a3b8", fontSize: 12, fontWeight: 600, letterSpacing: 0.3 }}>{props.title}</span>
        {props.icon ? <span style={{ fontSize: 16, opacity: 0.85 }}>{props.icon}</span> : null}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: "#f8fafc", marginTop: 6 }}>{props.value}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, gap: 8 }}>
        <span style={{ color: "#64748b", fontSize: 11, lineHeight: 1.35 }}>{props.sub ?? "vs prior window"}</span>
        <span style={{ color: trendColor, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>{props.trend ?? ""}</span>
      </div>
    </motion.div>
  );
}

function Panel(props: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "linear-gradient(180deg, rgba(15,23,42,0.92), rgba(2,6,23,0.96))",
        border: "1px solid rgba(51,65,85,0.9)",
        borderRadius: 16,
        padding: 18,
        boxShadow: "0 16px 40px rgba(0,0,0,0.35)",
      }}
    >
      <h3 style={{ margin: 0, fontSize: 16, color: "#e2e8f0" }}>{props.title}</h3>
      {props.subtitle ? (
        <p style={{ margin: "6px 0 14px", color: "#64748b", fontSize: 13, lineHeight: 1.45 }}>{props.subtitle}</p>
      ) : (
        <div style={{ height: 10 }} />
      )}
      {props.children}
    </div>
  );
}

const SECTION_DEFAULTS: Record<AnalyticsSectionKey, boolean> = {
  kpis: true,
  production: true,
  sales: true,
  buyer: true,
  labor: true,
  financial: true,
  executive: true,
  strain: true,
};

export function AnalyticsDashboard(props: {
  data: AnalyticsOverviewJson | null;
  loading: boolean;
  error: string | null;
  from: string;
  to: string;
  onFromToChange: (next: { from: string; to: string }) => void;
  facility: string;
  onFacilityChange: (v: string) => void;
  department: string;
  onDepartmentChange: (v: string) => void;
  autoRefresh: boolean;
  onAutoRefreshChange: (v: boolean) => void;
  onManualRefresh: () => void;
  /** When set, section visibility is controlled by the parent (e.g. analytics page + strain charts). */
  sectionPrefs?: Record<AnalyticsSectionKey, boolean>;
  onSectionPrefsChange?: (next: Record<AnalyticsSectionKey, boolean>) => void;
}) {
  const [internalPrefs, setInternalPrefs] = useState(loadAnalyticsDashboardPrefs);
  const prefs = props.sectionPrefs ?? internalPrefs;
  const [customizeOpen, setCustomizeOpen] = useState(false);

  const persistPrefs = useCallback(
    (next: Record<AnalyticsSectionKey, boolean>) => {
      saveAnalyticsDashboardPrefs(next);
      props.onSectionPrefsChange?.(next);
      if (props.sectionPrefs === undefined) setInternalPrefs(next);
    },
    [props],
  );

  const services = pick(props.data, "services") as Record<string, boolean> | undefined;

  const exportCsv = useCallback(() => {
    const d = props.data;
    if (!d) return;
    const rows: string[][] = [["section", "key", "value"]];
    const kpis = pick(d, "kpis") as Record<string, unknown> | undefined;
    if (kpis) {
      for (const [k, v] of Object.entries(kpis)) {
        rows.push(["kpi", k, JSON.stringify(v)]);
      }
    }
    rows.push(["meta", "range", JSON.stringify(pick(d, "range"))]);
    const blob = new Blob([rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics-overview-${props.from}-${props.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [props.data, props.from, props.to]);

  const kpi = useMemo(() => {
    const d = props.data;
    if (!d) return null;
    const kpis = pick(d, "kpis") as Record<string, Record<string, unknown>> | undefined;
    if (!kpis) return null;
    return kpis;
  }, [props.data]);

  const vsLabel = useMemo(() => {
    const r = pick(props.data, "range") as { prevFrom?: string; prevTo?: string } | undefined;
    if (r?.prevFrom && r?.prevTo) return `vs ${r.prevFrom} – ${r.prevTo}`;
    return "vs prior window";
  }, [props.data]);

  const headerRangeLabel = useMemo(() => {
    try {
      const a = new Date(`${props.from}T00:00:00Z`);
      const b = new Date(`${props.to}T00:00:00Z`);
      return `${a.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${b.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
    } catch {
      return `${props.from} – ${props.to}`;
    }
  }, [props.from, props.to]);

  const revTrend = trendLine((kpi?.totalRevenue as { trend?: { pct: number; up: boolean } })?.trend ?? null);
  const ordTrend = trendLine((kpi?.totalOrders as { trend?: { pct: number; up: boolean } })?.trend ?? null);
  const growthTrend = trendLine((kpi?.monthlyGrowthPct as { trend?: { pct: number; up: boolean } })?.trend ?? null);
  const activeBatches = kpi?.activeBatches as
    | { value?: number; cultivationOpen?: number; extraction?: number; packaging?: number }
    | undefined;

  return (
    <div style={{ maxWidth: 1480, margin: "0 auto", paddingBottom: 48 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginBottom: 22,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: "#f8fafc", letterSpacing: -0.5 }}>
            Analytics Overview
          </h1>
          <p style={{ margin: "8px 0 0", color: "#94a3b8", fontSize: 15 }}>
            Real-time insights across all operations · <span style={{ color: "#cbd5e1" }}>{headerRangeLabel}</span>
          </p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "#94a3b8" }}>
            From
            <input
              type="date"
              value={props.from}
              onChange={(e) => props.onFromToChange({ from: e.target.value, to: props.to })}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid #334155",
                background: "#0f172a",
                color: "#e2e8f0",
                fontWeight: 600,
              }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "#94a3b8" }}>
            To
            <input
              type="date"
              value={props.to}
              onChange={(e) => props.onFromToChange({ from: props.from, to: e.target.value })}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid #334155",
                background: "#0f172a",
                color: "#e2e8f0",
                fontWeight: 600,
              }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "#94a3b8" }}>
            Facility
            <input
              placeholder="Room contains…"
              value={props.facility}
              onChange={(e) => props.onFacilityChange(e.target.value)}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid #334155",
                background: "#0f172a",
                color: "#e2e8f0",
                width: 140,
              }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "#94a3b8" }}>
            Department
            <select
              value={props.department}
              onChange={(e) => props.onDepartmentChange(e.target.value)}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid #334155",
                background: "#0f172a",
                color: "#e2e8f0",
                fontWeight: 600,
              }}
            >
              <option value="all">All</option>
              <option value="cultivation">Cultivation</option>
              <option value="extraction">Extraction</option>
              <option value="packaging">Packaging</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => {}}
            style={{
              padding: "9px 14px",
              borderRadius: 10,
              border: "1px solid #475569",
              background: "#1e293b",
              color: "#e2e8f0",
              fontWeight: 600,
              cursor: "default",
              opacity: 0.65,
            }}
            title="Advanced filters ship next"
          >
            Filters
          </button>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              color: "#cbd5e1",
              fontSize: 13,
              padding: "8px 10px",
              border: "1px solid #334155",
              borderRadius: 10,
              background: "#0f172a",
            }}
          >
            <input
              type="checkbox"
              checked={props.autoRefresh}
              onChange={(e) => props.onAutoRefreshChange(e.target.checked)}
            />
            Auto 60s
          </label>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!props.data}
            style={{
              padding: "9px 14px",
              borderRadius: 10,
              border: "1px solid #475569",
              background: "#1e293b",
              color: "#e2e8f0",
              fontWeight: 600,
              cursor: props.data ? "pointer" : "not-allowed",
              opacity: props.data ? 1 : 0.5,
            }}
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => setCustomizeOpen(true)}
            style={{
              padding: "9px 16px",
              borderRadius: 10,
              border: "1px solid rgba(34,197,94,0.45)",
              background: "linear-gradient(90deg, #14532d, #166534)",
              color: "#ecfdf5",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Customize
          </button>
          <button
            type="button"
            onClick={props.onManualRefresh}
            style={{
              padding: "9px 14px",
              borderRadius: 10,
              border: "1px solid #334155",
              background: "#0f172a",
              color: "#e2e8f0",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {props.error ? (
        <p style={{ color: "#fca5a5", textAlign: "center", marginBottom: 16 }}>{props.error}</p>
      ) : null}
      {props.loading && !props.data ? (
        <p style={{ color: "#94a3b8", textAlign: "center" }}>Loading operational snapshot…</p>
      ) : null}

      {prefs.kpis && kpi ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <KpiCard
            title="Total revenue"
            value={money(Number((kpi.totalRevenue as { value?: unknown })?.value))}
            sub={vsLabel}
            trend={revTrend.text}
            trendUp={revTrend.up}
            icon="◆"
          />
          <KpiCard
            title="Total orders"
            value={String(Number((kpi.totalOrders as { value?: unknown })?.value) || 0)}
            sub={vsLabel}
            trend={ordTrend.text}
            trendUp={ordTrend.up}
            icon="◇"
          />
          <KpiCard
            title="Active batches"
            value={String(Number(activeBatches?.value) || 0)}
            sub={`Cult ${activeBatches?.cultivationOpen ?? "—"} · Ext ${activeBatches?.extraction ?? "—"} · Pkg ${activeBatches?.packaging ?? "—"}`}
            icon="▣"
          />
          <KpiCard
            title="Inventory value"
            value={money(Number((kpi.inventoryValue as { value?: unknown })?.value))}
            sub={String((kpi.inventoryValue as { note?: unknown })?.note ?? "").slice(0, 48)}
            icon="▤"
          />
          <KpiCard
            title="Gross margin %"
            value={pctStr(Number((kpi.grossMarginPct as { value?: unknown })?.value))}
            sub={String((kpi.grossMarginPct as { note?: unknown })?.note ?? "COGS model pending").slice(0, 52)}
            icon="%"
          />
          <KpiCard
            title="Labor cost today"
            value={money(Number((kpi.laborCostToday as { value?: unknown })?.value))}
            sub="UTC day window"
            icon="⏱"
          />
          <KpiCard
            title="Labor contributors today"
            value={String(Number((kpi.employeesClockedIn as { value?: unknown })?.value) || 0)}
            sub={String((kpi.employeesClockedIn as { note?: unknown })?.note ?? "").slice(0, 56)}
            icon="👤"
          />
          <KpiCard
            title="Revenue momentum"
            value={pctStr(Number((kpi.monthlyGrowthPct as { value?: unknown })?.value))}
            sub={vsLabel}
            trend={growthTrend.text}
            trendUp={growthTrend.up}
            icon="↗"
          />
          <KpiCard
            title="Company health score"
            value={`${Number((kpi.companyHealthScore as { value?: unknown })?.value) || 0}`}
            sub={`/ ${Number((kpi.companyHealthScore as { scale?: unknown })?.scale) || 100} · rule blend`}
            icon="✦"
          />
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          alignItems: "stretch",
        }}
      >
        <div style={{ flex: "1 1 640px", display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          {prefs.production && services?.production ? (
            <Panel
              title="Production overview"
              subtitle="Cultivation, extraction, and packaging signals from relational workflow data."
            >
              {(() => {
                const p = pick(props.data, "production") as Record<string, unknown> | null | undefined;
                if (!p) return <p style={{ color: "#94a3b8" }}>No production snapshot.</p>;
                return (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, fontSize: 13 }}>
                    {[
                      ["Plants (Veg est.)", String(p.plantsVeg ?? 0)],
                      ["Plants (Flower est.)", String(p.plantsFlower ?? 0)],
                      ["Harvested this month", String(p.harvestedThisMonth ?? 0)],
                      ["Room utilization %", p.roomUtilizationPct != null ? `${p.roomUtilizationPct}%` : "—"],
                      ["Extraction in progress", String(activeBatches?.extraction ?? 0)],
                      ["Packaging in progress", String(activeBatches?.packaging ?? 0)],
                      ["Open cultivation batches", String(activeBatches?.cultivationOpen ?? 0)],
                      ["METRC sync health", p.metrcSyncHealth != null ? `${p.metrcSyncHealth}%` : "—"],
                    ].map(([k, v]) => (
                      <div
                        key={k}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 10,
                          background: "#0f172a",
                          border: "1px solid #1e293b",
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 8,
                        }}
                      >
                        <span style={{ color: "#94a3b8" }}>{k}</span>
                        <strong style={{ color: "#e2e8f0" }}>{v}</strong>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </Panel>
          ) : null}

          {prefs.sales && services?.seller ? (
            <Panel title="Sales overview" subtitle="LeafLink wholesale (synced DB) + NexBatch marketplace seller totals.">
              {(() => {
                const s = pick(props.data, "sales") as Record<string, unknown> | null | undefined;
                if (!s) return <p style={{ color: "#94a3b8" }}>No sales snapshot.</p>;
                const top = (s.topProducts as { name: string; revenue: number }[]) || [];
                return (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
                    <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 }}>
                      <div>
                        <span style={{ color: "#94a3b8" }}>Combined</span>{" "}
                        <strong>{money(Number(s.totalSales))}</strong>
                      </div>
                      <div>
                        <span style={{ color: "#94a3b8" }}>LeafLink</span>{" "}
                        <strong>{money(Number(s.leafLink))}</strong>
                      </div>
                      <div>
                        <span style={{ color: "#94a3b8" }}>NexBatch</span>{" "}
                        <strong>{money(Number(s.nexbatch))}</strong>
                      </div>
                      <div>
                        <span style={{ color: "#94a3b8" }}>Avg order</span>{" "}
                        <strong>{money(Number(s.avgOrderValue))}</strong>
                      </div>
                    </div>
                    <div>
                      <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 6 }}>Top products (marketplace lines)</div>
                      <ul style={{ margin: 0, paddingLeft: 16, color: "#e2e8f0", fontSize: 13 }}>
                        {top.length === 0 ? <li style={{ color: "#64748b" }}>No line items in range</li> : null}
                        {top.map((r) => (
                          <li key={r.name} style={{ marginBottom: 4 }}>
                            {r.name}{" "}
                            <span style={{ color: "#86efac" }}>{money(r.revenue)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                );
              })()}
            </Panel>
          ) : null}

          {prefs.buyer && services?.buyer ? (
            <Panel title="Buyer activity" subtitle="Marketplace purchases attributed to this company as buyer.">
              {(() => {
                const b = pick(props.data, "buyer") as Record<string, unknown> | null | undefined;
                if (!b) return <p style={{ color: "#94a3b8" }}>No buyer snapshot.</p>;
                return (
                  <p style={{ margin: 0, color: "#e2e8f0", fontSize: 14 }}>
                    <strong>{money(Number(b.totalPurchases))}</strong> across{" "}
                    <strong>{String(b.orderCount)}</strong> orders (range).
                  </p>
                );
              })()}
            </Panel>
          ) : null}

          {prefs.labor && services?.payrollLabor ? (
            <Panel title="Labor overview" subtitle="From LaborEntry in range (UTC). Dead time uses a conservative estimate until clock vs task reconciliation ships.">
              {(() => {
                const l = pick(props.data, "labor") as Record<string, unknown> | null | undefined;
                if (!l) return <p style={{ color: "#94a3b8" }}>No labor snapshot.</p>;
                const pct = l.productivityPct != null && Number.isFinite(Number(l.productivityPct)) ? Number(l.productivityPct) : null;
                return (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
                    <div style={{ width: 140, height: 140, position: "relative" }}>
                      <svg viewBox="0 0 36 36" style={{ width: "100%", height: "100%" }}>
                        <path
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                          fill="none"
                          stroke="#334155"
                          strokeWidth="3"
                        />
                        {pct != null ? (
                          <path
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            fill="none"
                            stroke="#22c55e"
                            strokeWidth="3"
                            strokeDasharray={`${pct}, 100`}
                          />
                        ) : null}
                      </svg>
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexDirection: "column",
                          fontSize: 12,
                          color: "#e2e8f0",
                          fontWeight: 800,
                        }}
                      >
                        {pct != null ? `${pct}%` : "—"}
                        <span style={{ fontSize: 10, color: "#64748b", fontWeight: 600 }}>productivity</span>
                      </div>
                    </div>
                    <div style={{ flex: 1, fontSize: 13, color: "#cbd5e1", lineHeight: 1.7, minWidth: 200 }}>
                      <div>
                        Productive hours: <strong>{Number(l.productiveHours).toFixed(1)}</strong>
                      </div>
                      <div>
                        Dead time (est.): <strong>{Number(l.deadHours).toFixed(1)}</strong> h
                      </div>
                      <div>
                        Break hours: <strong>{Number(l.breakHours).toFixed(1)}</strong>
                      </div>
                      <div>
                        Labor cost (range): <strong>{money(Number(l.laborCostRange))}</strong>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </Panel>
          ) : null}

          {prefs.financial ? (
            <Panel title="Financial & platform" subtitle="Revenue window + UsageEvent estimated vendor costs (UTC month).">
              {(() => {
                const f = pick(props.data, "financial") as Record<string, unknown> | null | undefined;
                if (!f) return null;
                const parts = (f.costBreakdown as { label: string; value: number }[]) || [];
                return (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12, fontSize: 13 }}>
                    <div style={{ color: "#cbd5e1" }}>
                      Window revenue (orders + marketplace seller):{" "}
                      <strong style={{ color: "#86efac" }}>{money(Number(f.revenueWindow))}</strong>
                    </div>
                    <div style={{ color: "#cbd5e1" }}>
                      Platform costs (month est.):{" "}
                      <strong>{money(Number(f.platformCostsMonth))}</strong>
                    </div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 6 }}>Cost breakdown by provider</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {parts.length === 0 ? (
                          <span style={{ color: "#64748b" }}>No usage events this month.</span>
                        ) : null}
                        {parts.map((p) => (
                          <div
                            key={p.label}
                            style={{ display: "flex", justifyContent: "space-between", color: "#e2e8f0" }}
                          >
                            <span>{p.label}</span>
                            <span>{money(p.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </Panel>
          ) : null}

          {prefs.executive && services?.executive && Array.isArray(pick(props.data, "executiveCompare")) ? (
            <Panel title="Multi-company (platform)" subtitle="NexBatch platform operators — wholesale + marketplace seller revenue in the same window.">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(pick(props.data, "executiveCompare") as { companyId: string; name: string; revenue: number }[]).map(
                  (row) => (
                    <div
                      key={row.companyId}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "8px 10px",
                        borderRadius: 8,
                        background: "#0f172a",
                        border: "1px solid #1e293b",
                        fontSize: 13,
                      }}
                    >
                      <span style={{ color: "#e2e8f0" }}>{row.name}</span>
                      <strong style={{ color: "#86efac" }}>{money(row.revenue)}</strong>
                    </div>
                  ),
                )}
              </div>
            </Panel>
          ) : null}
        </div>

        <div style={{ flex: "1 1 300px", maxWidth: 420, display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <Panel title="Live operations" subtitle="Workflow pressure; polls with overview refresh.">
            <ul style={{ margin: 0, paddingLeft: 16, color: "#e2e8f0", fontSize: 13, listStyle: "disc" }}>
              {(pick(props.data, "liveOps") as { title: string; detail: string; href?: string }[] | undefined)?.map(
                (x) => (
                  <li key={x.title} style={{ marginBottom: 10 }}>
                    <div style={{ fontWeight: 700 }}>{x.title}</div>
                    <div style={{ color: "#94a3b8" }}>{x.detail}</div>
                    {x.href ? (
                      <a href={x.href} style={{ color: "#38bdf8", fontSize: 12 }}>
                        Open →
                      </a>
                    ) : null}
                  </li>
                ),
              )}
            </ul>
            <div style={{ marginTop: 14, color: "#94a3b8", fontSize: 12, fontWeight: 700 }}>Recent task logs</div>
            <ul style={{ margin: "8px 0 0", paddingLeft: 16, color: "#cbd5e1", fontSize: 12, listStyle: "circle" }}>
              {(pick(props.data, "taskLogPreview") as { stage?: string; minutes?: number; at?: string }[] | undefined)
                ?.slice(0, 8)
                .map((t, i) => (
                  <li key={`${t.at}-${i}`} style={{ marginBottom: 6 }}>
                    <span style={{ color: "#e2e8f0" }}>{String(t.stage ?? "—")}</span> · {t.minutes ?? 0}m ·{" "}
                    {t.at ? new Date(t.at).toLocaleString() : ""}
                  </li>
                ))}
            </ul>
          </Panel>

          <Panel title="AI insights" subtitle="Deterministic rules over synced operational metrics (no LLM required).">
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: "#e2e8f0", listStyle: "disc" }}>
              {(pick(props.data, "insights") as { title: string; detail: string }[] | undefined)?.map((ins) => (
                <li key={ins.title} style={{ marginBottom: 10 }}>
                  <strong>{ins.title}</strong> — <span style={{ color: "#94a3b8" }}>{ins.detail}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Alert center" subtitle="Operational + integration risk flags from current snapshot.">
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, listStyle: "disc" }}>
              {(pick(props.data, "alerts") as { severity: string; title: string; detail: string; at: string }[] | undefined)?.map(
                (a) => (
                  <li key={`${a.title}-${a.at}`} style={{ marginBottom: 10 }}>
                    <span style={{ color: "#f87171", fontWeight: 800 }}>[{a.severity}]</span>{" "}
                    <span style={{ color: "#fecaca" }}>{a.title}</span>
                    <div style={{ color: "#94a3b8" }}>{a.detail}</div>
                  </li>
                ),
              )}
            </ul>
          </Panel>
        </div>
      </div>

      {customizeOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={() => setCustomizeOpen(false)}
        >
          <div
            style={{
              maxWidth: 420,
              width: "100%",
              background: "#0f172a",
              border: "1px solid #334155",
              borderRadius: 14,
              padding: 20,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0, color: "#e2e8f0" }}>Dashboard sections</h3>
            <p style={{ color: "#64748b", fontSize: 13, marginTop: 0 }}>
              Strain charts render below the overview when Production is enabled.
            </p>
            <div style={{ display: "grid", gap: 10 }}>
              {(Object.keys(SECTION_DEFAULTS) as AnalyticsSectionKey[]).map((key) => (
                <label key={key} style={{ color: "#cbd5e1", display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={prefs[key]}
                    onChange={(e) => persistPrefs({ ...prefs, [key]: e.target.checked })}
                  />
                  {key}
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setCustomizeOpen(false)}
              style={{
                marginTop: 16,
                padding: "10px 16px",
                borderRadius: 10,
                border: "none",
                background: "#22c55e",
                color: "#022c22",
                fontWeight: 800,
                cursor: "pointer",
                width: "100%",
              }}
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
