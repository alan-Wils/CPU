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
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Nav from "@/components/Nav";
import PageAccessGate from "@/components/PageAccessGate";
import {
  fetchOrdersAnalytics,
  getSelectedCompanyId,
  type OrdersAnalyticsCustomerDto,
  type OrdersAnalyticsDto,
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
  from.setUTCDate(from.getUTCDate() - 90);
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

const btnSmall: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 10,
  border: "1px solid rgba(148,163,184,0.35)",
  background: "rgba(2,6,23,0.65)",
  color: "#cbd5e1",
  fontWeight: 600,
  fontSize: 12,
  cursor: "pointer",
};

function fmtShortDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(t));
}

function usd(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function toSortableMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function ChartTooltip(props: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: string;
  valuePrefix?: string;
  valueSuffix?: string;
  formatValue?: (n: number) => string;
}) {
  const { active, payload, label, formatValue } = props;
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
            {formatValue && typeof p.value === "number"
              ? formatValue(p.value)
              : typeof p.value === "number"
                ? String(p.value)
                : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

type GraphMode = "revenue" | "orders" | "samples" | "orderPoints";

type ScatterPoint = {
  x: number;
  y: number;
  orderNumber: string;
  createdAt: string;
  customerKey: string;
  customerLabel: string;
};

export default function OrdersAnalyticsPage() {
  const initial = useMemo(() => defaultRange(), []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  /** When false, LeafLink CRM “Current Customer” filter is not applied — counts include any buyer seen in saved orders that pass totals/cancel filters. */
  const [currentCustomersOnly, setCurrentCustomersOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<OrdersAnalyticsDto | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [customerListOpen, setCustomerListOpen] = useState(true);
  const [graphMode, setGraphMode] = useState<GraphMode>("revenue");
  const [detailCustomerKey, setDetailCustomerKey] = useState<string | null>(null);
  const [sampleCustomerKey, setSampleCustomerKey] = useState<string | null>(null);

  const load = useCallback(async (opts?: { refreshLeafLink?: boolean; silent?: boolean }) => {
    const refreshLeafLink = Boolean(opts?.refreshLeafLink);
    const silent = Boolean(opts?.silent);
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const cid = getSelectedCompanyId().trim();
      const out = await fetchOrdersAnalytics(from, to, cid || undefined, {
        refreshLeafLink,
        currentCustomersOnly,
      });
      setData(out);
    }
    catch (e: unknown) {
      if (!silent) {
        setError(e instanceof Error ? e.message : "Could not load analytics.");
        setData(null);
      }
    }
    finally {
      if (!silent) setLoading(false);
    }
  }, [from, to, currentCustomersOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    let lightInFlight = false;
    let fullInFlight = false;

    const runLightPoll = async () => {
      if (cancelled || lightInFlight || document.hidden) return;
      lightInFlight = true;
      try {
        await load({ refreshLeafLink: false, silent: true });
      }
      finally {
        lightInFlight = false;
      }
    };

    const runFullPull = async () => {
      if (cancelled || fullInFlight || document.hidden) return;
      fullInFlight = true;
      try {
        await load({ refreshLeafLink: true, silent: true });
      }
      finally {
        fullInFlight = false;
      }
    };

    const lightTimer = window.setInterval(() => {
      void runLightPoll();
    }, 15000);
    const fullTimer = window.setInterval(() => {
      void runFullPull();
    }, 120000);

    return () => {
      cancelled = true;
      window.clearInterval(lightTimer);
      window.clearInterval(fullTimer);
    };
  }, [load]);

  useEffect(() => {
    if (!data?.customers?.length) {
      setSelectedKeys(new Set());
      return;
    }
    setSelectedKeys(new Set(data.customers.map((c) => c.key)));
  }, [data]);

  const toggleKey = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (!data?.customers) return;
    setSelectedKeys(new Set(data.customers.map((c) => c.key)));
  }, [data]);

  const selectNone = useCallback(() => {
    setSelectedKeys(new Set());
  }, []);

  const selectedCustomers = useMemo(() => {
    if (!data?.customers) return [];
    return data.customers.filter((c) => selectedKeys.has(c.key));
  }, [data, selectedKeys]);

  const sortedCustomers = useMemo(() => {
    if (!data?.customers) return [];
    return data.customers
      .slice()
      .sort((a, b) => {
        const delta = toSortableMs(b.lastPurchaseDate) - toSortableMs(a.lastPurchaseDate);
        if (delta !== 0) return delta;
        return a.label.localeCompare(b.label);
      });
  }, [data]);

  const seriesMeta = useMemo(
    () => selectedCustomers.map((c) => ({ key: c.key, label: c.label })),
    [selectedCustomers],
  );

  const chartRows = useMemo(() => {
    if (!data?.days?.length) return [];
    return data.days.map((date, i) => {
      const row: Record<string, unknown> = { date, dateLabel: date };
      for (const c of selectedCustomers) {
        if (graphMode === "revenue")
          row[c.key] = c.revenueByDay[i] ?? 0;
        else if (graphMode === "orders")
          row[c.key] = c.orderCountByDay[i] ?? 0;
        else if (graphMode === "samples")
          row[c.key] = c.sampleUnitsByDay[i] ?? 0;
      }
      return row;
    });
  }, [data, selectedCustomers, graphMode]);

  const scatterPoints = useMemo((): ScatterPoint[] => {
    if (!data?.qualifyingOrders?.length || !data.customers?.length) return [];
    const labelByKey = new Map(data.customers.map((c) => [c.key, c.label]));
    return data.qualifyingOrders
      .filter((o) => selectedKeys.has(o.customerKey))
      .map((o) => {
        const xm = Date.parse(o.createdAt);
        if (!Number.isFinite(xm)) return null;
        return {
          x: xm,
          y: o.totalUsd,
          orderNumber: o.orderNumber,
          createdAt: o.createdAt,
          customerKey: o.customerKey,
          customerLabel: labelByKey.get(o.customerKey) ?? o.customerKey,
        };
      })
      .filter((p): p is ScatterPoint => p != null);
  }, [data, selectedKeys]);

  const detailCustomer = useMemo(() => {
    if (!detailCustomerKey || !data?.customers?.length) return null;
    return data.customers.find((c) => c.key === detailCustomerKey) ?? null;
  }, [data, detailCustomerKey]);

  const detailOrders = useMemo(() => {
    if (!detailCustomerKey || !data?.qualifyingOrders?.length) return [];
    return data.qualifyingOrders
      .filter((o) => o.customerKey === detailCustomerKey)
      .slice()
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }, [data, detailCustomerKey]);

  const sampleCustomer = useMemo(() => {
    if (!sampleCustomerKey || !data?.customers?.length) return null;
    return data.customers.find((c) => c.key === sampleCustomerKey) ?? null;
  }, [data, sampleCustomerKey]);

  const chartTitle =
    graphMode === "revenue"
      ? "Revenue by customer (per day)"
      : graphMode === "orders"
        ? "Qualifying orders by customer (per day)"
        : graphMode === "samples"
          ? "Sample units by customer (per day)"
          : "Each qualifying order total (points)";

  const yTickFormatter = useCallback(
    (v: unknown) => {
      const n = typeof v === "number" ? v : Number(v);
      if (graphMode === "revenue") {
        return new Intl.NumberFormat("en-US", {
          notation: Number.isFinite(n) && n >= 1000 ? "compact" : "standard",
          maximumFractionDigits: 0,
        }).format(Number.isFinite(n) ? n : 0);
      }
      return String(Number.isFinite(n) ? Math.round(n) : 0);
    },
    [graphMode],
  );

  const tooltipFormat = useCallback(
    (n: number) => {
      if (graphMode === "revenue") return usd(n);
      return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n);
    },
    [graphMode],
  );

  const minOrder = data?.minOrderTotal ?? 50;

  return (
    <PageAccessGate permission="page.orders">
      <div style={shellStyle}>
        <Nav />
        <div style={{ maxWidth: 1280, margin: "0 auto" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 18 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 32, fontWeight: 900, color: "#f8fafc" }}>Order analytics</h1>
              <p style={{ margin: "8px 0 0", fontSize: 15, color: "#94a3b8", maxWidth: 760, lineHeight: 1.5 }}>
                The customer list counts buyers with at least one non-cancelled order in range with headline total ≥ {usd(minOrder)}
                (“qualifying”). By default those buyers must also appear in LeafLink with CRM status{' '}
                <strong style={{ fontWeight: 700, color: "#cbd5e1" }}>Current Customer</strong>
                {' — '}uncheck below to chart every buyer in your saved LeafLink orders for this range (still excludes cancelled /
                tiny invoices). Charts use persisted orders plus any fresh pull you request. Samples use LeafLink is_sample flags,
                product/sample listing states, and name/SKU/note hints. UTC.
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
              <button
                type="button"
                style={btnGhost}
                onClick={() => void load({ refreshLeafLink: true })}
                disabled={loading}
                title="Paginate LeafLink now, merge into saved orders, then chart from the database"
              >
                {loading ? "…" : "Pull from LeafLink → save"}
              </button>
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  marginLeft: 4,
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#cbd5e1",
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                <input
                  type="checkbox"
                  checked={currentCustomersOnly}
                  onChange={(e) => setCurrentCustomersOnly(e.target.checked)}
                />
                Only LeafLink “Current Customer”
              </label>
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

            {data?.qualifyingOrdersTruncated ? (
              <p style={{ fontSize: 13, color: "#fbbf24", marginBottom: 12 }}>
                Per-order scatter list capped at {data.qualifyingOrders.length} newest qualifying orders — narrow the date
                range to include all orders in the payload.
              </p>
            ) : null}

            {data && data.ordersIncluded === 0 && data.configured && data.integrationEnabled && !loading ? (
              <p style={{ color: "#94a3b8" }}>
                No qualifying orders in this range (need total ≥ {usd(minOrder)}, not cancelled).
              </p>
            ) : null}

            {data && data.configured && data.integrationEnabled && !loading ? (
              <p style={{ fontSize: 13, color: "#64748b", marginBottom: 16, lineHeight: 1.55 }}>
                Charts use saved orders in this app ({data.storedRowsInRange} stored row
                {data.storedRowsInRange === 1 ? "" : "s"} overlapping this range
                {data.storedSnapshotMaxUpdatedAt
                  ? ` · newest save ${fmtShortDate(data.storedSnapshotMaxUpdatedAt)}`
                  : ""}
                ).
                {data.storedRowsInRange === 0 ? " Open the Orders page or run Multi-page sync, or use “Pull from LeafLink → save”." : ""}{" "}
                {data.filteredByLeafLinkCurrentCustomerStatus
                  ? `Customer list is restricted to LeafLink status: Current Customer (${data.leafLinkCurrentCustomerCount} total in LeafLink). `
                  : ""}
                {data.ordersIncluded > 0
                  ? `${data.ordersIncluded} qualifying order(s) · ${data.customers.length} active customer(s) · UTC dates`
                  : data.storedRowsInRange > 0
                    ? `${data.storedRowsInRange} stored order(s) in range (none meet the ${usd(data.minOrderTotal)} non-cancelled filters).`
                    : null}
                {data.leafLinkRefreshRan ? ` · LeafLink pull ran this request (${data.pagesScanned} page(s)).` : ""}
              </p>
            ) : null}

            {data && data.customers.length > 0 ? (
              <div
                style={{
                  marginBottom: 22,
                  borderRadius: 16,
                  border: "1px solid rgba(148,163,184,0.22)",
                  overflow: "hidden",
                  background: "rgba(2,6,23,0.45)",
                }}
              >
                <button
                  type="button"
                  onClick={() => setCustomerListOpen((o) => !o)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "14px 16px",
                    border: "none",
                    background: "rgba(15,23,42,0.55)",
                    color: "#e2e8f0",
                    cursor: "pointer",
                    fontWeight: 800,
                    fontSize: 15,
                    textAlign: "left",
                  }}
                >
                  <span>
                    {customerListOpen ? "▼" : "▶"} Active customers ({data.customers.length}) — choose who to graph
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8" }}>
                    {selectedKeys.size} selected
                  </span>
                </button>
                {customerListOpen ? (
                  <div style={{ padding: "12px 14px 16px" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                      <button type="button" style={btnSmall} onClick={selectAll}>
                        Select all
                      </button>
                      <button type="button" style={btnSmall} onClick={selectNone}>
                        Select none
                      </button>
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                          <tr style={{ color: "#94a3b8", textAlign: "left" }}>
                            <th style={{ padding: "8px 10px", width: 40 }} />
                            <th style={{ padding: "8px 10px" }}>Customer</th>
                            <th style={{ padding: "8px 10px" }}>Last purchase (UTC)</th>
                            <th style={{ padding: "8px 10px" }}>Last order</th>
                            <th style={{ padding: "8px 10px" }}>Sum in range</th>
                            <th style={{ padding: "8px 10px" }}>Sample units</th>
                            <th style={{ padding: "8px 10px", minWidth: 220 }}>Sample types (qty)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedCustomers.map((c: OrdersAnalyticsCustomerDto) => (
                            <tr key={c.key} style={{ borderTop: "1px solid rgba(148,163,184,0.12)" }}>
                              <td style={{ padding: "10px" }}>
                                <input
                                  type="checkbox"
                                  checked={selectedKeys.has(c.key)}
                                  onChange={() => toggleKey(c.key)}
                                  aria-label={`Include ${c.label} on chart`}
                                />
                              </td>
                              <td style={{ padding: "10px", fontWeight: 700 }}>
                                <button
                                  type="button"
                                  onClick={() => setDetailCustomerKey(c.key)}
                                  style={{
                                    border: "none",
                                    background: "transparent",
                                    color: "#c4b5fd",
                                    cursor: "pointer",
                                    fontWeight: 800,
                                    padding: 0,
                                  }}
                                  title={`View all ${c.label} orders in range`}
                                >
                                  {c.label}
                                </button>
                              </td>
                              <td style={{ padding: "10px", color: "#cbd5e1" }}>{fmtShortDate(c.lastPurchaseDate)}</td>
                              <td style={{ padding: "10px", color: "#cbd5e1", fontVariantNumeric: "tabular-nums" }}>
                                {usd(c.lastOrderTotal)}
                              </td>
                              <td style={{ padding: "10px", color: "#cbd5e1", fontVariantNumeric: "tabular-nums" }}>
                                {usd(c.orderTotalInRange)}
                              </td>
                              <td style={{ padding: "10px", color: "#cbd5e1" }}>{c.sampleUnitsInRange}</td>
                              <td style={{ padding: "10px", color: "#94a3b8", lineHeight: 1.45 }}>
                                {c.samplesByType.length === 0 ? (
                                  "—"
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setSampleCustomerKey(c.key)}
                                    style={{
                                      border: "none",
                                      background: "transparent",
                                      color: "#93c5fd",
                                      cursor: "pointer",
                                      fontWeight: 700,
                                      padding: 0,
                                      textAlign: "left",
                                    }}
                                    title={`View itemized sample list for ${c.label}`}
                                  >
                                    {c.samplesByType.map((s) => `${s.typeLabel} (${s.units})`).join(" · ")}
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: "#94a3b8", marginRight: 4 }}>Chart</span>
              {(
                [
                  { id: "revenue" as const, label: "Revenue ($)" },
                  { id: "orders" as const, label: "Order count" },
                  { id: "samples" as const, label: "Sample units" },
                  { id: "orderPoints" as const, label: "Each order ($)" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setGraphMode(opt.id)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 10,
                    border:
                      graphMode === opt.id
                        ? "1px solid rgba(167,139,250,0.7)"
                        : "1px solid rgba(148,163,184,0.3)",
                    background:
                      graphMode === opt.id
                        ? "linear-gradient(135deg, rgba(91,33,182,0.45), rgba(76,29,149,0.35))"
                        : "rgba(2,6,23,0.55)",
                    color: graphMode === opt.id ? "#f8fafc" : "#cbd5e1",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {graphMode === "orderPoints" ? (
              <OrderScatterBlock
                title={chartTitle}
                points={scatterPoints}
                selectedCustomers={selectedCustomers}
                loading={loading}
                emptyHint={
                  data && data.customers.length > 0 && selectedKeys.size === 0
                    ? "Select at least one customer to plot."
                    : "No qualifying orders for selected customers in this range."
                }
              />
            ) : (
              <ChartBlock
                title={chartTitle}
                rows={chartRows}
                meta={seriesMeta}
                loading={loading}
                yTickFormatter={yTickFormatter}
                tooltipFormat={tooltipFormat}
                emptyHint={
                  data && data.customers.length > 0 && selectedKeys.size === 0
                    ? "Select at least one customer to plot."
                    : undefined
                }
              />
            )}
          </div>
        </div>
        {detailCustomer ? (
          <div
            role="presentation"
            onClick={() => setDetailCustomerKey(null)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(2,6,23,0.78)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
              zIndex: 90,
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`${detailCustomer.label} orders`}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "min(980px, 96vw)",
                maxHeight: "86vh",
                overflow: "auto",
                borderRadius: 18,
                border: "1px solid rgba(148,163,184,0.3)",
                background: "linear-gradient(135deg, rgba(15,23,42,0.96), rgba(2,6,23,0.96))",
                boxShadow: "0 26px 80px rgba(0,0,0,0.6)",
                padding: 18,
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: "#f8fafc" }}>{detailCustomer.label}</h3>
                  <p style={{ margin: "6px 0 0", color: "#94a3b8", fontSize: 13 }}>
                    {detailOrders.length} qualifying order(s) from {from} to {to} UTC
                  </p>
                </div>
                <button type="button" style={btnSmall} onClick={() => setDetailCustomerKey(null)}>
                  Close
                </button>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: "#94a3b8", textAlign: "left" }}>
                      <th style={{ padding: "8px 10px" }}>Order #</th>
                      <th style={{ padding: "8px 10px" }}>Date (UTC)</th>
                      <th style={{ padding: "8px 10px" }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailOrders.length === 0 ? (
                      <tr style={{ borderTop: "1px solid rgba(148,163,184,0.12)" }}>
                        <td colSpan={3} style={{ padding: "12px 10px", color: "#94a3b8" }}>
                          No qualifying orders for this customer in the selected range.
                        </td>
                      </tr>
                    ) : (
                      detailOrders.map((o) => (
                        <tr key={o.orderId} style={{ borderTop: "1px solid rgba(148,163,184,0.12)" }}>
                          <td style={{ padding: "10px", color: "#c4b5fd", fontWeight: 700 }}>{o.orderNumber}</td>
                          <td style={{ padding: "10px", color: "#cbd5e1" }}>{fmtShortDate(o.createdAt)}</td>
                          <td style={{ padding: "10px", color: "#cbd5e1", fontVariantNumeric: "tabular-nums" }}>{usd(o.totalUsd)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
        {sampleCustomer ? (
          <div
            role="presentation"
            onClick={() => setSampleCustomerKey(null)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(2,6,23,0.78)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
              zIndex: 91,
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`${sampleCustomer.label} sample items`}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "min(1100px, 96vw)",
                maxHeight: "86vh",
                overflow: "auto",
                borderRadius: 18,
                border: "1px solid rgba(148,163,184,0.3)",
                background: "linear-gradient(135deg, rgba(15,23,42,0.96), rgba(2,6,23,0.96))",
                boxShadow: "0 26px 80px rgba(0,0,0,0.6)",
                padding: 18,
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: "#f8fafc" }}>
                    {sampleCustomer.label} sample items
                  </h3>
                  <p style={{ margin: "6px 0 0", color: "#94a3b8", fontSize: 13 }}>
                    {sampleCustomer.sampleLineItems.length} sample line item(s) from {from} to {to} UTC
                  </p>
                </div>
                <button type="button" style={btnSmall} onClick={() => setSampleCustomerKey(null)}>
                  Close
                </button>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: "#94a3b8", textAlign: "left" }}>
                      <th style={{ padding: "8px 10px" }}>Date (UTC)</th>
                      <th style={{ padding: "8px 10px" }}>Order #</th>
                      <th style={{ padding: "8px 10px" }}>Sample item</th>
                      <th style={{ padding: "8px 10px" }}>SKU</th>
                      <th style={{ padding: "8px 10px" }}>Type</th>
                      <th style={{ padding: "8px 10px" }}>Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sampleCustomer.sampleLineItems.length === 0 ? (
                      <tr style={{ borderTop: "1px solid rgba(148,163,184,0.12)" }}>
                        <td colSpan={6} style={{ padding: "12px 10px", color: "#94a3b8" }}>
                          No sample items for this customer in the selected range.
                        </td>
                      </tr>
                    ) : (
                      sampleCustomer.sampleLineItems.map((item, idx) => (
                        <tr key={`${item.orderId}:${item.productName}:${idx}`} style={{ borderTop: "1px solid rgba(148,163,184,0.12)" }}>
                          <td style={{ padding: "10px", color: "#cbd5e1" }}>{fmtShortDate(item.createdAt)}</td>
                          <td style={{ padding: "10px", color: "#c4b5fd", fontWeight: 700 }}>{item.orderNumber}</td>
                          <td style={{ padding: "10px", color: "#e2e8f0" }}>{item.productName}</td>
                          <td style={{ padding: "10px", color: "#94a3b8" }}>{item.sku || "—"}</td>
                          <td style={{ padding: "10px", color: "#93c5fd" }}>{item.typeLabel}</td>
                          <td style={{ padding: "10px", color: "#cbd5e1", fontVariantNumeric: "tabular-nums" }}>{item.quantity}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </PageAccessGate>
  );
}

function OrderScatterTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: ScatterPoint }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const when = fmtShortDate(d.createdAt);
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
      <div style={{ fontWeight: 800, marginBottom: 6, color: "#e2e8f0" }}>{d.customerLabel}</div>
      <div style={{ color: "#94a3b8" }}>
        Order #{d.orderNumber} · {when}
      </div>
      <div style={{ marginTop: 6, fontWeight: 700, color: "#a78bfa" }}>{usd(d.y)}</div>
    </div>
  );
}

function OrderScatterBlock({
  title,
  points,
  selectedCustomers,
  loading,
  emptyHint,
}: {
  title: string;
  points: ScatterPoint[];
  selectedCustomers: OrdersAnalyticsCustomerDto[];
  loading: boolean;
  emptyHint?: string;
}) {
  const show = !loading && points.length > 0 && selectedCustomers.length > 0;
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ margin: "0 0 12px", fontSize: 18, fontWeight: 800, color: "#c4b5fd" }}>{title}</h2>
      <div style={{ width: "100%", height: 400, opacity: loading ? 0.45 : 1 }}>
        {show ? (
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 12, right: 24, left: 8, bottom: 36 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
              <XAxis
                type="number"
                dataKey="x"
                domain={["dataMin", "dataMax"]}
                stroke="#64748b"
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                tickFormatter={(ms) =>
                  typeof ms === "number" && Number.isFinite(ms)
                    ? new Intl.DateTimeFormat("en-US", {
                        month: "2-digit",
                        day: "2-digit",
                        timeZone: "UTC",
                      }).format(new Date(ms))
                    : ""
                }
                name="Date"
              />
              <YAxis
                type="number"
                dataKey="y"
                stroke="#64748b"
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                tickFormatter={(v) =>
                  new Intl.NumberFormat("en-US", {
                    notation: Number(v as number) >= 1000 ? "compact" : "standard",
                    maximumFractionDigits: 0,
                    style: "currency",
                    currency: "USD",
                  }).format(typeof v === "number" ? v : Number(v))
                }
              />
              <Tooltip content={<OrderScatterTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {selectedCustomers.map((c, i) => (
                <Scatter
                  key={c.key}
                  name={c.label}
                  data={points.filter((p) => p.customerKey === c.key)}
                  fill={LINE_COLORS[i % LINE_COLORS.length]}
                  line={false}
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", textAlign: "center", padding: 16 }}>
            {loading ? "Loading chart…" : emptyHint ?? "No data"}
          </div>
        )}
      </div>
    </div>
  );
}

function ChartBlock({
  title,
  rows,
  meta,
  loading,
  yTickFormatter,
  tooltipFormat,
  emptyHint,
}: {
  title: string;
  rows: Record<string, unknown>[];
  meta: { key: string; label: string }[];
  loading: boolean;
  yTickFormatter: (v: unknown) => string;
  tooltipFormat: (n: number) => string;
  emptyHint?: string;
}) {
  const show = rows.length > 0 && meta.length > 0;
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ margin: "0 0 12px", fontSize: 18, fontWeight: 800, color: "#c4b5fd" }}>{title}</h2>
      <div style={{ width: "100%", height: 400, opacity: loading ? 0.45 : 1 }}>
        {show ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
              <XAxis dataKey="date" stroke="#64748b" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis stroke="#64748b" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={yTickFormatter} />
              <Tooltip
                content={(tp) => (
                  <ChartTooltip
                    active={tp.active}
                    label={typeof tp.label === "string" ? tp.label : tp.label != null ? String(tp.label) : undefined}
                    payload={tp.payload?.map((p) => ({
                      name: p.name != null ? String(p.name) : undefined,
                      value: typeof p.value === "number" ? p.value : Number(p.value),
                      color: typeof p.color === "string" ? p.color : undefined,
                    }))}
                    formatValue={tooltipFormat}
                  />
                )}
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
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", textAlign: "center", padding: 16 }}>
            {loading ? "Loading chart…" : emptyHint ?? "No data"}
          </div>
        )}
      </div>
    </div>
  );
}
