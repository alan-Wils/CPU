"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { salesSellerDashboard, type SellerDashboardDto } from "@/lib/api";

function cardShell(extra?: CSSProperties): CSSProperties {
  return {
    borderRadius: 16,
    border: "1px solid rgba(51,65,85,0.65)",
    background: "linear-gradient(145deg, rgba(15,23,42,0.92), rgba(15,23,42,0.75))",
    boxShadow: "0 18px 50px rgba(0,0,0,0.35)",
    padding: 18,
    ...extra,
  };
}

function pctFmt(p: number | null): string {
  if (p === null || Number.isNaN(p)) return "—";
  const sign = p >= 0 ? "↑" : "↓";
  return `${sign} ${Math.abs(p).toFixed(1)}%`;
}

function KpiCard(props: {
  label: string;
  value: string;
  sub?: string;
  pct: number | null;
  icon: string;
  accent: string;
}) {
  const pctColor =
    props.pct === null ? "#64748b" : props.pct >= 0 ? "#34d399" : "#fb923c";
  return (
    <div style={cardShell({ minHeight: 130 })}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em" }}>{props.label}</div>
          <div style={{ marginTop: 10, fontSize: 26, fontWeight: 900, color: "#f8fafc", letterSpacing: "-0.03em" }}>{props.value}</div>
          <div style={{ marginTop: 8, fontSize: 12, color: pctColor, fontWeight: 700 }}>{pctFmt(props.pct)}</div>
          {props.sub ? <div style={{ marginTop: 4, fontSize: 11, color: "#64748b" }}>{props.sub}</div> : null}
        </div>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            fontSize: 20,
            background: `radial-gradient(circle at 30% 25%, ${props.accent}55, rgba(15,23,42,0.9))`,
            border: `1px solid ${props.accent}66`,
            boxShadow: `0 0 22px ${props.accent}44`,
          }}
        >
          {props.icon}
        </div>
      </div>
    </div>
  );
}

function MiniLine(props: { data: Array<{ day: string; total: number }>; color: string }) {
  const chartData = props.data.map((d) => ({
    name: d.day.slice(5),
    v: Math.round(d.total * 100) / 100,
  }));
  return (
    <div style={{ height: 88, marginTop: 12 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
          <Line type="monotone" dataKey="v" stroke={props.color} strokeWidth={2} dot={false} />
          <XAxis dataKey="name" hide />
          <YAxis hide domain={["auto", "auto"]} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function SalesPanel(props: {
  title: string;
  subtitle: string;
  total: string;
  pct: number | null;
  vs: string;
  series: Array<{ day: string; total: number }>;
  color: string;
  disconnected?: boolean;
  disconnectedHint?: string;
}) {
  return (
    <div style={{ ...cardShell(), position: "relative", overflow: "hidden" }}>
      {props.disconnected ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 2,
            background: "rgba(2,6,23,0.82)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            textAlign: "center",
            gap: 8,
          }}
        >
          <div style={{ fontWeight: 900, color: "#f8fafc" }}>{props.disconnectedHint || "LeafLink not connected"}</div>
          <Link href="/seller/integrations" style={{ color: "#67e8f9", fontWeight: 800 }}>
            Connect in Integrations
          </Link>
        </div>
      ) : null}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 17, color: "#f8fafc" }}>{props.title}</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{props.subtitle}</div>
          <div style={{ marginTop: 12, fontSize: 24, fontWeight: 900, color: "#f8fafc" }}>{props.total}</div>
          <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: pctFmt(props.pct).startsWith("↑") ? "#34d399" : "#fb923c" }}>
            {pctFmt(props.pct)} <span style={{ color: "#64748b", fontWeight: 600 }}>vs {props.vs}</span>
          </div>
        </div>
        <Link
          href="/seller/reports"
          style={{
            padding: "8px 12px",
            borderRadius: 12,
            border: "1px solid rgba(148,163,184,0.35)",
            color: "#e2e8f0",
            fontWeight: 800,
            fontSize: 12,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          View Report
        </Link>
      </div>
      <MiniLine data={props.series} color={props.color} />
    </div>
  );
}

const GROW_LS = "nexbatch_seller_grow_banner_dismissed";

export default function SellerDashboardView() {
  const [dash, setDash] = useState<SellerDashboardDto | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [fromStr, setFromStr] = useState("");
  const [toStr, setToStr] = useState("");
  const [growHidden, setGrowHidden] = useState(false);

  useEffect(() => {
    try {
      setGrowHidden(localStorage.getItem(GROW_LS) === "1");
    } catch {
      setGrowHidden(false);
    }
  }, []);

  const fetchDashboard = useCallback(async (params?: { from?: string; to?: string }) => {
    setErr("");
    setLoading(true);
    try {
      const d = await salesSellerDashboard(params);
      setDash(d);
      return d;
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not load dashboard.");
      setDash(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const d = await fetchDashboard();
      if (!cancelled && d?.dateRange?.from && d?.dateRange?.to) {
        setFromStr(d.dateRange.from.slice(0, 10));
        setToStr(d.dateRange.to.slice(0, 10));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchDashboard]);

  async function applyDateRange() {
    if (!fromStr || !toStr) return;
    await fetchDashboard({
      from: new Date(`${fromStr}T00:00:00.000Z`).toISOString(),
      to: new Date(`${toStr}T23:59:59.999Z`).toISOString(),
    });
  }

  const pieData = useMemo(() => {
    if (!dash) return [];
    return dash.orderStatus.segments
      .filter((s) => s.count > 0)
      .map((s) => ({ name: s.label, value: s.count, color: s.color }));
  }, [dash]);

  const salesOverviewData = useMemo(() => {
    if (!dash) return [];
    return dash.salesOverview.series.map((d) => ({
      name: d.day.slice(5),
      total: Math.round(d.total * 100) / 100,
    }));
  }, [dash]);

  function dismissGrow() {
    try {
      localStorage.setItem(GROW_LS, "1");
    } catch {
      /* ignore */
    }
    setGrowHidden(true);
  }

  if (loading && !dash) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: "#93c5fd" }}>
        Loading dashboard…
      </div>
    );
  }

  if (err && !dash) {
    return (
      <div style={{ padding: 24, borderRadius: 16, border: "1px solid rgba(248,113,113,0.45)", background: "rgba(127,29,29,0.25)", color: "#fecaca" }}>
        {err}
      </div>
    );
  }

  if (!dash) return null;

  const welcomeName = dash.company.name || "Seller";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: "#f8fafc" }}>Dashboard</h1>
          <p style={{ margin: "10px 0 0", color: "#94a3b8", maxWidth: 560, lineHeight: 1.55 }}>
            Welcome back, {welcomeName}! Here&apos;s what&apos;s happening with your business.
          </p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" }}>Date Range</span>
          <input
            type="date"
            value={fromStr}
            onChange={(e) => setFromStr(e.target.value)}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(51,65,85,0.65)",
              background: "rgba(15,23,42,0.85)",
              color: "#e2e8f0",
            }}
          />
          <span style={{ color: "#475569" }}>–</span>
          <input
            type="date"
            value={toStr}
            onChange={(e) => setToStr(e.target.value)}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(51,65,85,0.65)",
              background: "rgba(15,23,42,0.85)",
              color: "#e2e8f0",
            }}
          />
          <button
            type="button"
            onClick={() => void applyDateRange()}
            style={{
              padding: "10px 16px",
              borderRadius: 12,
              border: "1px solid rgba(56,189,248,0.45)",
              background: "rgba(8,47,73,0.55)",
              color: "#7dd3fc",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Apply
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 14,
        }}
      >
        <KpiCard
          label="Total Sales"
          value={dash.kpis.totalSales.valueFormatted}
          pct={dash.kpis.totalSales.pctChange}
          sub={`vs ${dash.kpis.totalSales.vsLabel}`}
          icon="💠"
          accent="#a855f7"
        />
        <KpiCard label="Total Orders" value={String(dash.kpis.totalOrders.value)} pct={dash.kpis.totalOrders.pctChange} sub={`vs ${dash.kpis.totalOrders.vsLabel}`} icon="📦" accent="#3b82f6" />
        <KpiCard label="New Customers" value={String(dash.kpis.newCustomers.value)} pct={dash.kpis.newCustomers.pctChange} sub={`vs ${dash.kpis.newCustomers.vsLabel}`} icon="👥" accent="#14b8a6" />
        <KpiCard label="Active Products" value={String(dash.kpis.activeProducts.value)} pct={dash.kpis.activeProducts.pctChange} sub={`vs ${dash.kpis.activeProducts.vsLabel}`} icon="🏷️" accent="#22c55e" />
        <KpiCard label="Low Stock Items" value={String(dash.kpis.lowStockItems.value)} pct={dash.kpis.lowStockItems.pctChange} sub={`vs ${dash.kpis.lowStockItems.vsLabel}`} icon="⚠️" accent="#f97316" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
        <SalesPanel
          title="NexBatch Sales"
          subtitle="Selected range"
          total={dash.salesPanels.nexbatch.totalFormatted}
          pct={dash.salesPanels.nexbatch.pctChange}
          vs={dash.dateRange.compareLabel}
          series={dash.salesPanels.nexbatch.series}
          color="#a855f7"
        />
        <SalesPanel
          title="LeafLink Sales"
          subtitle="Selected range"
          total={dash.leafLinkConnected ? dash.salesPanels.leafLink.totalFormatted : "$0"}
          pct={dash.leafLinkConnected ? dash.salesPanels.leafLink.pctChange : null}
          vs={dash.dateRange.compareLabel}
          series={dash.leafLinkConnected ? dash.salesPanels.leafLink.series : dash.salesPanels.leafLink.series.map((d) => ({ ...d, total: 0 }))}
          color="#22c55e"
          disconnected={!dash.leafLinkConnected}
        />
        <SalesPanel
          title="Combined Sales"
          subtitle="Selected range"
          total={dash.salesPanels.combined.totalFormatted}
          pct={dash.salesPanels.combined.pctChange}
          vs={dash.dateRange.compareLabel}
          series={dash.salesPanels.combined.series}
          color="#22d3ee"
          disconnected={false}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
        <div style={cardShell({ gridColumn: "span 2 / auto", minWidth: 280 })}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 900, fontSize: 17, color: "#f8fafc" }}>Sales Overview</div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>NexBatch wholesale orders</div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#94a3b8" }}>Range total · {dash.salesOverview.totalFormatted}</div>
          </div>
          <div style={{ height: 260, marginTop: 12 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={salesOverviewData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#33415555" />
                <XAxis dataKey="name" stroke="#64748b" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis stroke="#64748b" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 12 }}
                  labelStyle={{ color: "#e2e8f0" }}
                />
                <Line type="monotone" dataKey="total" stroke="#a855f7" strokeWidth={2} dot={{ r: 3, fill: "#c084fc" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div style={cardShell({ minHeight: 320 })}>
          <div style={{ fontWeight: 900, fontSize: 17, color: "#f8fafc", marginBottom: 8 }}>Order Status</div>
          <div style={{ height: 220, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData.length ? pieData : [{ name: "None", value: 1, color: "#334155" }]}
                    dataKey="value"
                    innerRadius={52}
                    outerRadius={78}
                    paddingAngle={2}
                  >
                    {(pieData.length ? pieData : [{ name: "None", value: 1, color: "#334155" }]).map((entry, index) => (
                      <Cell key={`c-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ width: 140, flexShrink: 0 }}>
              <div style={{ textAlign: "center", fontWeight: 900, fontSize: 22, color: "#f8fafc" }}>{dash.orderStatus.total}</div>
              <div style={{ textAlign: "center", fontSize: 11, color: "#64748b", marginBottom: 10 }}>Total Orders</div>
              {dash.orderStatus.segments.map((s) => (
                <div key={s.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6, color: "#cbd5e1" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
                    {s.label}
                  </span>
                  <span style={{ fontWeight: 800 }}>{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={cardShell()}>
          <div style={{ fontWeight: 900, fontSize: 17, color: "#f8fafc", marginBottom: 12 }}>Revenue by Category</div>
          {dash.revenueByCategory.map((row) => (
            <div key={row.category} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                <span style={{ color: "#e2e8f0", fontWeight: 700 }}>{row.category}</span>
                <span style={{ color: "#94a3b8" }}>
                  {row.revenueFormatted}{" "}
                  <span style={{ color: "#64748b" }}>({row.pct.toFixed(1)}%)</span>
                </span>
              </div>
              <div style={{ height: 8, borderRadius: 999, background: "rgba(51,65,85,0.6)", overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min(100, row.pct)}%`,
                    borderRadius: 999,
                    background: "linear-gradient(90deg, #6366f1, #a855f7)",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
        <div style={cardShell()}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontWeight: 900, fontSize: 17, color: "#f8fafc" }}>Recent Orders</div>
            <Link href="/seller/orders" style={{ color: "#67e8f9", fontWeight: 800, fontSize: 13, textDecoration: "none" }}>
              View all
            </Link>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {dash.recentOrders.length === 0 ? (
              <div style={{ color: "#64748b", fontSize: 14 }}>No orders in this range.</div>
            ) : (
              dash.recentOrders.slice(0, 5).map((o) => (
                <Link
                  key={o.id}
                  href={`/seller/orders#${encodeURIComponent(o.id)}`}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "center",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(51,65,85,0.55)",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, color: "#f8fafc" }}>{o.orderNumber}</div>
                    <div style={{ fontSize: 12, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {o.customerName}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 800, color: "#e2e8f0" }}>{o.amountFormatted}</div>
                    <div
                      style={{
                        marginTop: 4,
                        display: "inline-block",
                        fontSize: 11,
                        fontWeight: 800,
                        padding: "3px 8px",
                        borderRadius: 999,
                        border: "1px solid rgba(148,163,184,0.35)",
                        color: "#cbd5e1",
                      }}
                    >
                      {o.statusLabel}
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
          <Link
            href="/seller/orders"
            style={{
              display: "block",
              marginTop: 14,
              textAlign: "center",
              padding: "12px",
              borderRadius: 12,
              border: "1px solid rgba(167,139,250,0.45)",
              color: "#e9d5ff",
              fontWeight: 800,
              textDecoration: "none",
            }}
          >
            View All Orders
          </Link>
        </div>

        <div style={cardShell()}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontWeight: 900, fontSize: 17, color: "#f8fafc" }}>Inventory Alerts</div>
            <Link href="/seller/inventory" style={{ color: "#67e8f9", fontWeight: 800, fontSize: 13, textDecoration: "none" }}>
              View all
            </Link>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {dash.inventoryAlerts.length === 0 ? (
              <div style={{ color: "#64748b", fontSize: 14 }}>No low-stock alerts.</div>
            ) : (
              dash.inventoryAlerts.slice(0, 5).map((p) => (
                <div
                  key={p.productId}
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(251,146,60,0.35)",
                    background: "rgba(124,45,18,0.15)",
                  }}
                >
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      background: p.imageUrl ? `url(${p.imageUrl}) center/cover` : "rgba(51,65,85,0.7)",
                      flexShrink: 0,
                      border: "1px solid rgba(148,163,184,0.25)",
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, color: "#f8fafc" }}>
                      {p.name}{" "}
                      <span style={{ color: "#94a3b8", fontWeight: 600 }}>({p.categoryLine})</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#fdba74", marginTop: 4 }}>{p.warning}</div>
                  </div>
                  <div style={{ marginLeft: "auto", fontSize: 18 }}>
                    ⚠️
                  </div>
                </div>
              ))
            )}
          </div>
          <Link
            href="/seller/inventory"
            style={{
              display: "block",
              marginTop: 14,
              textAlign: "center",
              padding: "12px",
              borderRadius: 12,
              border: "1px solid rgba(251,146,60,0.45)",
              color: "#fdba74",
              fontWeight: 800,
              textDecoration: "none",
            }}
          >
            Manage Inventory
          </Link>
        </div>

        <div style={cardShell()}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontWeight: 900, fontSize: 17, color: "#f8fafc" }}>Top Selling Products</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>Selected range</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {dash.topSellingProducts.length === 0 ? (
              <div style={{ color: "#64748b", fontSize: 14 }}>No product sales in this range.</div>
            ) : (
              dash.topSellingProducts.map((p) => (
                <div
                  key={p.rank}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "flex-start",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(51,65,85,0.55)",
                  }}
                >
                  <div style={{ display: "flex", gap: 10, minWidth: 0 }}>
                    <div style={{ fontWeight: 900, color: "#a855f7", width: 22 }}>{p.rank}</div>
                    <div>
                      <div style={{ fontWeight: 800, color: "#f8fafc" }}>{p.name}</div>
                      <div style={{ fontSize: 12, color: "#64748b" }}>{p.categoryLine}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontWeight: 900, color: "#e2e8f0" }}>{p.revenueFormatted}</div>
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>{p.qtyLabel}</div>
                  </div>
                </div>
              ))
            )}
          </div>
          <Link
            href="/sales/seller"
            style={{
              display: "block",
              marginTop: 14,
              textAlign: "center",
              padding: "12px",
              borderRadius: 12,
              border: "1px solid rgba(56,189,248,0.45)",
              color: "#7dd3fc",
              fontWeight: 800,
              textDecoration: "none",
            }}
          >
            View All Products
          </Link>
        </div>
      </div>

      {!growHidden ? (
        <div
          style={{
            ...cardShell({
              border: "1px solid rgba(109,40,217,0.45)",
              background: "linear-gradient(120deg, rgba(76,29,149,0.55), rgba(15,23,42,0.92))",
              position: "relative",
            }),
          }}
        >
          <button
            type="button"
            onClick={dismissGrow}
            aria-label="Dismiss"
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              border: "none",
              background: "rgba(15,23,42,0.55)",
              color: "#94a3b8",
              borderRadius: 8,
              cursor: "pointer",
              padding: "6px 10px",
              fontWeight: 800,
            }}
          >
            ✕
          </button>
          <div style={{ fontWeight: 900, fontSize: 20, color: "#f8fafc" }}>Grow Your Business</div>
          <p style={{ margin: "8px 0 18px", color: "#c4b5fd", maxWidth: 720 }}>
            Access tools and insights to scale your brand and reach more buyers.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            {[
              { href: "/seller/campaigns", t: "Launch Campaign", d: "Promote your products" },
              { href: "/seller/customers", t: "Customer Insights", d: "Understand your buyers" },
              { href: "/seller/analytics", t: "Market Analytics", d: "Track trends & demand" },
              { href: "/seller/promotions", t: "Bulk Discounts", d: "Create offers & deals" },
            ].map((x) => (
              <Link
                key={x.href}
                href={x.href}
                style={{
                  padding: 14,
                  borderRadius: 14,
                  border: "1px solid rgba(167,139,250,0.35)",
                  background: "rgba(15,23,42,0.55)",
                  textDecoration: "none",
                  color: "#f8fafc",
                }}
              >
                <div style={{ fontWeight: 900 }}>{x.t}</div>
                <div style={{ marginTop: 6, fontSize: 13, color: "#94a3b8" }}>{x.d}</div>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
        <div style={cardShell()}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontWeight: 900, fontSize: 17, color: "#f8fafc" }}>Customer Overview</div>
            <Link href="/seller/customers" style={{ color: "#67e8f9", fontWeight: 800, fontSize: 13, textDecoration: "none" }}>
              View all
            </Link>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>Total Customers</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#f8fafc" }}>{dash.customerOverview.totalCustomers}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>Repeat Customers</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#f8fafc" }}>
                {dash.customerOverview.repeatCustomers}
                {dash.customerOverview.repeatPct !== null ? (
                  <span style={{ fontSize: 13, color: "#94a3b8", fontWeight: 700 }}> ({dash.customerOverview.repeatPct.toFixed(0)}%)</span>
                ) : null}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>New This Period</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#f8fafc" }}>{dash.customerOverview.newThisPeriod}</div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {dash.customerOverview.topCustomers.map((c) => (
              <div key={c.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span style={{ color: "#e2e8f0", fontWeight: 700 }}>{c.name}</span>
                <span style={{ color: "#a78bfa", fontWeight: 800 }}>{c.totalSpendFormatted}</span>
              </div>
            ))}
          </div>
          <Link
            href="/seller/customers"
            style={{
              display: "block",
              marginTop: 14,
              textAlign: "center",
              padding: "12px",
              borderRadius: 12,
              border: "1px solid rgba(34,197,94,0.35)",
              color: "#86efac",
              fontWeight: 800,
              textDecoration: "none",
            }}
          >
            View Customers
          </Link>
        </div>

        <div style={cardShell()}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontWeight: 900, fontSize: 17, color: "#f8fafc" }}>CRM Activity</div>
            <Link href="/seller/crm" style={{ color: "#67e8f9", fontWeight: 800, fontSize: 13, textDecoration: "none" }}>
              View all
            </Link>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {dash.crmActivity.length === 0 ? (
              <div style={{ color: "#64748b", fontSize: 14 }}>No recent CRM events.</div>
            ) : (
              dash.crmActivity.map((ev) => (
                <div key={ev.id} style={{ borderLeft: "3px solid rgba(99,102,241,0.65)", paddingLeft: 12 }}>
                  <div style={{ fontWeight: 800, color: "#e2e8f0" }}>{ev.title}</div>
                  <div style={{ fontSize: 13, color: "#94a3b8" }}>{ev.subtitle}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{ev.atLabel}</div>
                </div>
              ))
            )}
          </div>
          <Link
            href="/seller/crm"
            style={{
              display: "block",
              marginTop: 14,
              textAlign: "center",
              padding: "12px",
              borderRadius: 12,
              border: "1px solid rgba(99,102,241,0.45)",
              color: "#c4b5fd",
              fontWeight: 800,
              textDecoration: "none",
            }}
          >
            Open CRM
          </Link>
        </div>

        <div style={cardShell()}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontWeight: 900, fontSize: 17, color: "#f8fafc" }}>Reports Overview</div>
            <Link href="/seller/reports" style={{ color: "#67e8f9", fontWeight: 800, fontSize: 13, textDecoration: "none" }}>
              View all
            </Link>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {dash.reportsOverview.map((r) => (
              <Link
                key={r.id}
                href={`/seller/reports?report=${encodeURIComponent(r.id)}`}
                style={{
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid rgba(51,65,85,0.55)",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <div style={{ fontWeight: 800, color: "#f8fafc" }}>{r.title}</div>
                <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>{r.description}</div>
              </Link>
            ))}
          </div>
          <Link
            href="/seller/reports"
            style={{
              display: "block",
              marginTop: 14,
              textAlign: "center",
              padding: "12px",
              borderRadius: 12,
              border: "1px solid rgba(56,189,248,0.45)",
              color: "#7dd3fc",
              fontWeight: 800,
              textDecoration: "none",
            }}
          >
            View All Reports
          </Link>
        </div>
      </div>
    </div>
  );
}
