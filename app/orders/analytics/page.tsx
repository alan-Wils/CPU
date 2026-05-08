"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Nav from "@/components/Nav";
import PageAccessGate from "@/components/PageAccessGate";
import {
  fetchOrdersAnalytics,
  getSelectedCompanyId,
  type OrdersAnalyticsDto,
  type OrdersAnalyticsSeriesMeta,
} from "@/lib/api";

function utcYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime());
  from.setUTCDate(from.getUTCDate() - 30);
  return { from: utcYmd(from), to: utcYmd(to) };
}

const LINE_COLORS = [
  "#a78bfa",
  "#22d3ee",
  "#34d399",
  "#fbbf24",
  "#f472b6",
  "#60a5fa",
  "#fb923c",
  "#94a3b8",
  "#e879f9",
  "#4ade80",
  "#64748b",
];

const shellStyle: CSSProperties = {
  minHeight: "100vh",
  padding: "24px 18px 48px",
  background:
    "radial-gradient(ellipse at top, rgba(91,33,182,0.35), transparent 55%), linear-gradient(180deg, #020617 0%, #0f172a 45%, #020617 100%)",
  color: "#e2e8f0",
};

const glassPanel: CSSProperties = {
  borderRadius: 22,
  border: "1px solid rgba(148, 163, 184, 0.22)",
  background: "linear-gradient(135deg, rgba(15,23,42,0.92), rgba(2,6,23,0.88))",
  boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
  padding: "22px 22px 26px",
  marginBottom: 20,
};

const filterInputStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(148,163,184,0.35)",
  background: "rgba(2,6,23,0.85)",
  color: "#e2e8f0",
  fontSize: 14,
};

const btnPrimary: CSSProperties = {
  padding: "10px 18px",
  borderRadius: 12,
  border: "1px solid rgba(139,92,246,0.55)",
  background: "linear-gradient(135deg, rgba(91,33,182,0.75), rgba(76,29,149,0.85))",
  color: "#fff",
  fontWeight: 800,
  fontSize: 14,
  cursor: "pointer",
};

const btnGhost: CSSProperties = {
  padding: "10px 18px",
  borderRadius: 12,
  border: "1px solid rgba(148,163,184,0.4)",
  background: "rgba(2,6,23,0.75)",
  color: "#cbd5e1",
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};

function RevenueTooltip(props: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: string;
}) {
  const { active, payload, label } = props;
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "rgba(15,23,42,0.95)",
        border: "1px solid rgba(148,163,184,0.35)",
        borderRadius: 10,
        padding: "10px 12px",
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 800, marginBottom: 6, color: "#e2e8f0" }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: "#cbd5e1", display: "flex", justifyContent: "space-between", gap: 16 }}>
          <span style={{ color: p.color }}>{p.name}</span>
          <span>
            {typeof p.value === "number"
              ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(p.value)
              : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function OrdersAnalyticsPage() {
  const initial = useMemo(() => defaultRange(), []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<OrdersAnalyticsDto | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const cid = getSelectedCompanyId().trim();
      const out = await fetchOrdersAnalytics(from, to, cid || undefined);
      setData(out);
    }
    catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not load analytics.");
      setData(null);
    }
    finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const lines = data?.seriesMeta ?? [];

  return (
    <PageAccessGate permission="page.orders">
      <div style={shellStyle}>
        <Nav />
        <div style={{ maxWidth: 1280, margin: "0 auto" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 18 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 32, fontWeight: 900, color: "#f8fafc" }}>Order analytics</h1>
              <p style={{ margin: "8px 0 0", fontSize: 15, color: "#94a3b8", maxWidth: 720, lineHeight: 1.5 }}>
                Wholesale orders by customer over time (LeafLink). Revenue is order total per day; second chart is order
                count per day.
              </p>
            </div>
            <Link href="/orders" style={btnGhost}>
              ← Back to orders
            </Link>
          </div>

          <div style={glassPanel}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 18 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, fontWeight: 700, color: "#94a3b8" }}>
                From (UTC)
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ ...filterInputStyle, minWidth: 160 }} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, fontWeight: 700, color: "#94a3b8" }}>
                To (UTC)
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ ...filterInputStyle, minWidth: 160 }} />
              </label>
              <button type="button" style={btnPrimary} onClick={() => void load()} disabled={loading}>
                {loading ? "Loading…" : "Apply range"}
              </button>
            </div>

            {error ? (
              <div
                style={{
                  padding: 14,
                  borderRadius: 12,
                  border: "1px solid rgba(248,113,113,0.45)",
                  background: "rgba(127,29,29,0.25)",
                  color: "#fecaca",
                  marginBottom: 12,
                }}
              >
                {error}
              </div>
            ) : null}

            {data && (!data.configured || !data.integrationEnabled) ? (
              <p style={{ color: "#94a3b8", marginTop: 8 }}>
                LeafLink is not configured for this company. Configure it under Company Admin, then return here.
              </p>
            ) : null}

            {data?.truncated ? (
              <p style={{ fontSize: 13, color: "#fbbf24", marginBottom: 12 }}>
                Showing data from the most recent pages scanned; date range may be incomplete — narrow the range or contact
                support to raise limits.
              </p>
            ) : null}

            {data && data.ordersIncluded === 0 && data.configured && data.integrationEnabled && !loading ? (
              <p style={{ color: "#94a3b8" }}>No orders in this date range.</p>
            ) : null}

            {data && data.ordersIncluded > 0 ? (
              <p style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>
                {data.ordersIncluded} orders · {data.pagesScanned} LeafLink page(s) scanned · UTC dates
              </p>
            ) : null}

            {!loading && lines.length === 0 && data?.configured && data?.integrationEnabled && data.ordersIncluded > 0 ? (
              <p style={{ color: "#94a3b8" }}>Could not build customer series (unexpected).</p>
            ) : null}

            <ChartBlock
              title="Revenue by customer (order total per day)"
              rows={data?.revenueByDay ?? []}
              meta={lines}
              loading={loading}
              revenueTooltip
              yTickFormatter={(v) => {
                const n = typeof v === "number" ? v : Number(v);
                return new Intl.NumberFormat("en-US", {
                  notation: Number.isFinite(n) && n >= 1000 ? "compact" : "standard",
                  maximumFractionDigits: 0,
                }).format(Number.isFinite(n) ? n : 0);
              }}
            />

            <ChartBlock
              title="Orders per customer (count per day)"
              rows={data?.orderCountByDay ?? []}
              meta={lines}
              loading={loading}
              revenueTooltip={false}
              yTickFormatter={(v) => String(v)}
            />
          </div>
        </div>
      </div>
    </PageAccessGate>
  );
}

function ChartBlock({
  title,
  rows,
  meta,
  loading,
  revenueTooltip,
  yTickFormatter,
}: {
  title: string;
  rows: Record<string, unknown>[];
  meta: OrdersAnalyticsSeriesMeta[];
  loading: boolean;
  revenueTooltip?: boolean;
  yTickFormatter: (v: unknown) => string;
}) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ margin: "0 0 12px", fontSize: 18, fontWeight: 800, color: "#c4b5fd" }}>{title}</h2>
      <div style={{ width: "100%", height: 360, opacity: loading ? 0.45 : 1 }}>
        {rows.length > 0 && meta.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
              <XAxis dataKey="date" stroke="#64748b" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis stroke="#64748b" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={yTickFormatter} />
              <Tooltip
                content={
                  revenueTooltip
                    ? (tp) => (
                        <RevenueTooltip
                          active={tp.active}
                          label={typeof tp.label === "string" ? tp.label : tp.label != null ? String(tp.label) : undefined}
                          payload={tp.payload?.map((p) => ({
                            name: p.name != null ? String(p.name) : undefined,
                            value: typeof p.value === "number" ? p.value : Number(p.value),
                            color: typeof p.color === "string" ? p.color : undefined,
                          }))}
                        />
                      )
                    : undefined
                }
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {meta.map((s, i) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={LINE_COLORS[i % LINE_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
            {loading ? "Loading chart…" : "No data"}
          </div>
        )}
      </div>
    </div>
  );
}
