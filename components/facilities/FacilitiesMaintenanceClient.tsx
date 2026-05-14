"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
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
import Nav from "@/components/Nav";
import {
  deleteFacilityWorkOrder,
  fetchFacilityMaintenanceDashboard,
  postFacilityAsset,
  postFacilityLocation,
  postFacilityPartRequest,
  postFacilityPmTask,
  postFacilityWorkOrder,
  type FacilityDashboardJson,
} from "@/lib/facilityMaintenanceApi";
import { getAuthUser } from "@/lib/auth";

function canInviteCompanyUsers(role: string): boolean {
  const r = String(role || "").trim().toUpperCase();
  return r === "OWNER" || r === "ADMIN";
}

function humanizeRole(role: string): string {
  const r = String(role || "").trim().toUpperCase();
  if (r === "OPERATIONS_MANAGER") return "Facilities Manager";
  if (r === "ADMIN") return "Company Admin";
  if (r === "OWNER") return "Company Owner";
  if (r === "FACILITY_MAINTENANCE_SPECIALIST") return "Facility Maintenance Specialist";
  if (r === "CULTIVATION_SPECIALIST") return "Cultivation Specialist";
  if (r === "EXTRACTION_SPECIALIST") return "Extraction Specialist";
  if (r === "PACKAGING_SPECIALIST") return "Packaging Specialist";
  if (r === "VIEW_ONLY") return "View Only";
  return r.replace(/_/g, " ") || "User";
}

const ROOM_LABELS: Record<string, string> = {
  cultivationRooms: "Cultivation Rooms",
  flowerRooms: "Flower Rooms",
  dryingRooms: "Drying Rooms",
  processingRooms: "Processing Room",
  extractionLabs: "Extraction Lab",
  packagingRooms: "Packaging Room",
  retailAreas: "Retail Area",
  warehouses: "Warehouse",
};

const STATUS_COLORS: Record<string, string> = {
  "In Progress": "#3b82f6",
  Scheduled: "#a855f7",
  Overdue: "#ef4444",
  Completed: "#22c55e",
  "On Hold": "#64748b",
};

const PRIORITY_COLORS: Record<string, string> = {
  High: "#ef4444",
  Medium: "#f59e0b",
  Low: "#3b82f6",
  None: "#64748b",
};

const CAL_KIND: Record<string, { label: string; color: string }> = {
  PM_SCHEDULED: { label: "PM Scheduled", color: "#a855f7" },
  INSPECTION: { label: "Inspections", color: "#38bdf8" },
  DUE_TODAY: { label: "Due Today", color: "#fbbf24" },
  OVERDUE: { label: "Overdue", color: "#f87171" },
};

type NavItem = { label: string; href: string };

const SIDEBAR: { title: string; items: NavItem[] }[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", href: "/" },
      { label: "Facilities Maintenance", href: "/facilities-maintenance" },
      { label: "Work Orders", href: "/facilities-maintenance#work-orders" },
      { label: "Preventive Maintenance", href: "/facilities-maintenance#preventive-maintenance" },
      { label: "Assets", href: "/facilities-maintenance#assets" },
      { label: "Locations", href: "/facilities-maintenance#locations" },
      { label: "Requests", href: "/facilities-maintenance#requests" },
    ],
  },
  {
    title: "Facility",
    items: [
      { label: "Rooms / Areas", href: "/facilities-maintenance#facility-rooms" },
      { label: "Utilities (Live)", href: "/facilities-maintenance#utilities" },
      { label: "Environmental (Live)", href: "/facilities-maintenance#environmental" },
      { label: "Access Control", href: "/facilities-maintenance#access-control" },
      { label: "Compliance", href: "/facilities-maintenance#compliance" },
    ],
  },
  {
    title: "Inventory",
    items: [
      { label: "Parts & Inventory", href: "/facilities-maintenance#inventory-parts" },
      { label: "Vendors", href: "/facilities-maintenance#vendors" },
      { label: "Purchase Orders", href: "/facilities-maintenance#purchase-orders" },
    ],
  },
  {
    title: "Documents",
    items: [
      { label: "SOPs & Manuals", href: "/facilities-maintenance#documents-sops" },
      { label: "Reports", href: "/facilities-maintenance#documents-reports" },
      { label: "Files", href: "/facilities-maintenance#documents-files" },
    ],
  },
  {
    title: "Settings",
    items: [
      { label: "Categories", href: "/facilities-maintenance#settings-categories" },
      { label: "Teams", href: "/facilities-maintenance#settings-teams" },
      { label: "Alerts", href: "/facilities-maintenance#settings-alerts" },
      { label: "Settings", href: "/facilities-maintenance#settings-general" },
    ],
  },
];

function sectionCard(id: string, title: string, children: React.ReactNode, extra?: React.ReactNode) {
  return (
    <section
      id={id}
      style={{
        scrollMarginTop: 96,
        background: "rgba(15, 23, 42, 0.82)",
        border: "1px solid rgba(148, 163, 184, 0.2)",
        borderRadius: 18,
        padding: 18,
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 900, color: "#e2e8f0" }}>{title}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

function emptyBlock(message: string) {
  return (
    <div style={{ color: "#64748b", fontSize: 14, padding: "12px 0" }}>
      {message}{" "}
      <span style={{ color: "#94a3b8" }}>Use Quick Actions below when available.</span>
    </div>
  );
}

export default function FacilitiesMaintenanceClient() {
  const pathname = usePathname();
  const [data, setData] = useState<FacilityDashboardJson | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [tableSearch, setTableSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState({ category: "", priority: "", status: "", assignedTo: "" });
  const [bellOpen, setBellOpen] = useState(false);
  const [newWoMenu, setNewWoMenu] = useState(false);

  const [modal, setModal] = useState<
    | "wo"
    | "pm"
    | "asset"
    | "parts"
    | "loc"
    | "report"
    | "systems"
    | "calendar"
    | "env"
    | "alerts"
    | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const d = await fetchFacilityMaintenanceDashboard();
      setData(d);
    } catch (e: unknown) {
      setLoadErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.location.hash?.replace(/^#/, "");
    if (!id) return;
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [pathname, data]);

  const user = getAuthUser();
  const canAdminTeams = canInviteCompanyUsers(String(user?.role || ""));

  const filteredRows = useMemo(() => {
    if (!data) return [];
    const q = tableSearch.trim().toLowerCase();
    return data.workOrders.filter((w) => {
      if (tab !== "All" && String(w.status) !== tab) return false;
      if (filters.category && w.category !== filters.category) return false;
      if (filters.priority && w.priority !== filters.priority) return false;
      if (filters.status && w.status !== filters.status) return false;
      if (filters.assignedTo && !w.assignedTo.toLowerCase().includes(filters.assignedTo.toLowerCase()))
        return false;
      if (!q) return true;
      const hay = [
        w.externalId,
        w.title,
        w.location,
        w.category,
        w.assignedTo,
        w.status,
        w.priority,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [data, tab, tableSearch, filters]);

  const globalSearchHay = useMemo(() => {
    if (!data || !search.trim()) return null;
    const q = search.trim().toLowerCase();
    const fromWo = data.workOrders.some((w) =>
      [w.externalId, w.title, w.location, w.category, w.assignedTo].join(" ").toLowerCase().includes(q),
    );
    const fromAssets = data.assets.some(
      (a: { assetName?: string; location?: string }) =>
        String(a.assetName || "").toLowerCase().includes(q) || String(a.location || "").toLowerCase().includes(q),
    );
    const fromLoc = data.locations.some(
      (l: { locationName?: string }) => String(l.locationName || "").toLowerCase().includes(q),
    );
    return { q, fromWo, fromAssets, fromLoc };
  }, [data, search]);

  const costChartData = useMemo(() => {
    if (!data) return [];
    return (data.profile.mtdCostSeries as { day: number; amount: number }[]).map((p) => ({
      day: p.day,
      amount: Math.round(p.amount),
    }));
  }, [data]);

  const calendarLegend = useMemo(() => {
    if (!data) return { PM_SCHEDULED: 0, INSPECTION: 0, DUE_TODAY: 0, OVERDUE: 0 };
    const m: Record<string, number> = {};
    for (const e of data.calendar.events) m[e.kind] = (m[e.kind] || 0) + 1;
    return m as Record<"PM_SCHEDULED" | "INSPECTION" | "DUE_TODAY" | "OVERDUE", number>;
  }, [data]);

  const exportCsv = () => {
    const rows = filteredRows;
    const header = ["ID", "Title", "Location", "Category", "Priority", "Status", "Assigned To", "Due Date"];
    const lines = [
      header.join(","),
      ...rows.map((w) =>
        [
          w.externalId,
          JSON.stringify(w.title),
          JSON.stringify(w.location),
          w.category,
          w.priority,
          w.status,
          JSON.stringify(w.assignedTo),
          w.dueDate,
        ].join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "recent-work-orders.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const k = data?.kpis;

  const donutData = useMemo(() => {
    if (!data) return [];
    return data.kpiMeta.statusChart.map((s) => ({ name: s.label, value: s.value }));
  }, [data]);

  const priorityData = useMemo(() => {
    if (!data) return [];
    return data.kpiMeta.priorityChart.map((p) => ({ name: p.label, value: p.value }));
  }, [data]);

  const modalOverlay: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(2,6,23,0.72)",
    zIndex: 1200,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  };

  const modalBox: React.CSSProperties = {
    background: "rgba(15,23,42,0.98)",
    border: "1px solid rgba(139,92,246,0.45)",
    borderRadius: 18,
    padding: 22,
    maxWidth: 520,
    width: "100%",
    maxHeight: "90vh",
    overflowY: "auto",
    color: "#e2e8f0",
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(139,92,246,0.16), transparent 32%), radial-gradient(circle at top right, rgba(56,189,248,0.12), transparent 35%), #020617",
        color: "#fff",
      }}
    >
      <div style={{ maxWidth: 1480, margin: "0 auto", padding: 16 }}>
        <header
          style={{
            background: "rgba(15, 23, 42, 0.82)",
            border: "1px solid rgba(148, 163, 184, 0.22)",
            borderRadius: 20,
            padding: 16,
            marginBottom: 14,
          }}
        >
          <Nav />
        </header>

        <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          <aside
            style={{
              width: 260,
              flexShrink: 0,
              background: "rgba(15, 23, 42, 0.92)",
              border: "1px solid rgba(148, 163, 184, 0.18)",
              borderRadius: 18,
              padding: 14,
              position: "sticky",
              top: 16,
              maxHeight: "calc(100vh - 32px)",
              overflowY: "auto",
            }}
          >
            {SIDEBAR.map((sec) => (
              <div key={sec.title} style={{ marginBottom: 18 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 900,
                    letterSpacing: "0.08em",
                    color: "#64748b",
                    marginBottom: 8,
                  }}
                >
                  {sec.title}
                </div>
                {sec.items.map((item) => {
                  const active =
                    item.href === "/facilities-maintenance" && pathname === "/facilities-maintenance";
                  return (
                    <a
                      key={item.label}
                      href={item.href}
                      style={{
                        display: "block",
                        padding: "8px 10px",
                        borderRadius: 10,
                        marginBottom: 4,
                        textDecoration: "none",
                        fontSize: 14,
                        fontWeight: active ? 800 : 600,
                        color: active ? "#c4b5fd" : "#cbd5e1",
                        background: active ? "rgba(91,33,182,0.35)" : "transparent",
                        border: active ? "1px solid rgba(139,92,246,0.5)" : "1px solid transparent",
                      }}
                    >
                      {item.label}
                    </a>
                  );
                })}
              </div>
            ))}
          </aside>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 16,
                background: "rgba(15,23,42,0.75)",
                border: "1px solid rgba(148,163,184,0.18)",
                borderRadius: 16,
                padding: "12px 16px",
              }}
            >
              <div style={{ fontWeight: 950, fontSize: 20, letterSpacing: "-0.03em" }}>NexBatch</div>
              <input
                placeholder="Search work orders, assets, locations..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  flex: "1 1 220px",
                  minWidth: 180,
                  maxWidth: 420,
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: "1px solid rgba(148,163,184,0.25)",
                  background: "rgba(2,6,23,0.65)",
                  color: "#fff",
                }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
                <button
                  type="button"
                  onClick={() => setBellOpen((v) => !v)}
                  style={iconBtn}
                  aria-label="Notifications"
                >
                  🔔
                </button>
                <button type="button" style={iconBtn} aria-label="Messages">
                  ✉️
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const el = document.getElementById("maintenance-calendar");
                    el?.scrollIntoView({ behavior: "smooth" });
                  }}
                  style={iconBtn}
                  aria-label="Calendar"
                >
                  📅
                </button>
                {bellOpen && data ? (
                  <div
                    style={{
                      position: "absolute",
                      right: 0,
                      top: 44,
                      width: 320,
                      maxHeight: 360,
                      overflowY: "auto",
                      background: "rgba(15,23,42,0.98)",
                      border: "1px solid rgba(148,163,184,0.3)",
                      borderRadius: 14,
                      padding: 12,
                      zIndex: 50,
                    }}
                  >
                    <div style={{ fontWeight: 900, marginBottom: 8 }}>Active Alerts</div>
                    {data.alerts.slice(0, 5).map((a) => (
                      <div key={a.id} style={{ fontSize: 13, marginBottom: 8, color: "#cbd5e1" }}>
                        <strong>{a.title}</strong>
                        <div style={{ color: "#94a3b8" }}>{a.locationLabel}</div>
                      </div>
                    ))}
                    <button type="button" style={linkBtn} onClick={() => setModal("alerts")}>
                      View all alerts →
                    </button>
                  </div>
                ) : null}
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  padding: "8px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(139,92,246,0.35)",
                  background: "rgba(91,33,182,0.15)",
                }}
              >
                <span style={{ fontWeight: 900 }}>{user?.username || "—"}</span>
                <span style={{ fontSize: 13, color: "#a5b4fc" }}>{humanizeRole(String(user?.role || ""))}</span>
              </div>
            </div>

            {globalSearchHay && !globalSearchHay.fromWo && !globalSearchHay.fromAssets && !globalSearchHay.fromLoc ? (
              <div style={{ color: "#fca5a5", marginBottom: 12, fontSize: 14 }}>
                No matches for “{globalSearchHay.q}” in work orders, assets, or locations.
              </div>
            ) : null}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 18 }}>
              <div>
                <h1 style={{ margin: 0, fontSize: 28, fontWeight: 950 }}>Facilities Maintenance</h1>
                <p style={{ margin: "8px 0 0", color: "#94a3b8", maxWidth: 720 }}>
                  Monitor, manage, and maintain all facility systems and equipment.
                </p>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={primaryBtn} onClick={exportCsv}>
                  Export
                </button>
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    style={primaryBtn}
                    onClick={() => {
                      setModal("wo");
                      setNewWoMenu(false);
                    }}
                  >
                    New Work Order ▾
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewWoMenu((v) => !v)}
                    style={{ ...primaryBtn, padding: "10px 12px", marginLeft: 4 }}
                    aria-label="More new actions"
                  >
                    ▾
                  </button>
                  {newWoMenu ? (
                    <div
                      style={{
                        position: "absolute",
                        right: 0,
                        top: 46,
                        background: "rgba(15,23,42,0.98)",
                        border: "1px solid rgba(148,163,184,0.3)",
                        borderRadius: 12,
                        padding: 8,
                        zIndex: 40,
                        minWidth: 200,
                      }}
                    >
                      <button type="button" style={ddItem} onClick={() => { setModal("wo"); setNewWoMenu(false); }}>
                        Quick: Work order
                      </button>
                      <button type="button" style={ddItem} onClick={() => { setModal("pm"); setNewWoMenu(false); }}>
                        Quick: PM task
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {loadErr ? (
              <div style={{ color: "#fecaca", marginBottom: 12 }}>{loadErr}</div>
            ) : null}
            {loading || !data || !k ? (
              <div style={{ color: "#94a3b8" }}>Loading…</div>
            ) : (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                    gap: 12,
                    marginBottom: 16,
                  }}
                >
                  <KpiCard
                    title="Total Work Orders"
                    value={String(k.totalWorkOrders)}
                    change={String(k.totalWorkOrdersChange)}
                    sub={String(k.totalWorkOrdersSub)}
                  />
                  <KpiCard title="Completed" value={String(k.completed)} change={String(k.completedChange)} sub={String(k.completedSub)} />
                  <KpiCard title="In Progress" value={String(k.inProgress)} change={String(k.inProgressChange)} sub={String(k.inProgressSub)} />
                  <KpiCard title="Overdue" value={String(k.overdue)} change={String(k.overdueChange)} sub={String(k.overdueSub)} />
                  <KpiCard
                    title="PM Compliance"
                    value={`${k.pmCompliancePct}%`}
                    change={String(k.pmComplianceChange)}
                    sub={String(k.pmComplianceSub)}
                  />
                  <KpiCard
                    title="Total Cost (MTD)"
                    value={`$${Number(k.totalCostMtd).toLocaleString()}`}
                    change={String(k.totalCostChange)}
                    sub={String(k.totalCostSub)}
                  />
                </div>

                {sectionCard(
                  "facility-overview",
                  "Facility Overview",
                  <>
                    <div style={{ color: "#e2e8f0", fontWeight: 800, fontSize: 18 }}>{data.profile.facilityName}</div>
                    <div style={{ color: "#94a3b8", marginTop: 6 }}>
                      {data.profile.addressLine1}
                      <br />
                      {data.profile.cityStateZip}
                    </div>
                    <div style={{ marginTop: 10, color: "#cbd5e1" }}>License: {data.profile.licenseNumber}</div>
                    <div style={{ color: "#cbd5e1" }}>Facility Size: {data.profile.facilitySizeSqFt.toLocaleString()} sq ft</div>
                    <div style={{ color: "#cbd5e1", marginBottom: 12 }}>Built: {data.profile.builtYear}</div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {Object.entries(data.profile.roomCounts || {}).map(([key, n]) => (
                        <div key={key} style={{ color: "#94a3b8" }}>
                          {ROOM_LABELS[key] || key}: <span style={{ color: "#e2e8f0", fontWeight: 700 }}>{n}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontWeight: 800, marginBottom: 8 }}>Critical Systems Status</div>
                      <div style={{ display: "grid", gap: 6 }}>
                        {data.systems.map((s) => (
                          <div key={s.id} style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>{s.name}</span>
                            <span style={{ color: "#86efac", fontWeight: 700 }}>{s.status}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <button type="button" style={{ ...linkBtn, marginTop: 12 }} onClick={() => setModal("systems")}>
                      View all systems →
                    </button>
                  </>,
                )}

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                    gap: 14,
                    marginBottom: 16,
                  }}
                >
                  {sectionCard(
                    "chart-status",
                    "Work Orders by Status",
                    <div style={{ height: 240 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={80} paddingAngle={2}>
                            {donutData.map((_, i) => (
                              <Cell key={i} fill={["#22c55e", "#3b82f6", "#ef4444", "#a855f7", "#64748b"][i % 5]} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155" }} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div style={{ textAlign: "center", marginTop: -36, fontWeight: 900, color: "#e2e8f0" }}>
                        {data.kpiMeta.statusChartCenterTotal} Total
                      </div>
                      {data.kpiMeta.statusChart.map((s) => (
                        <div key={s.label} style={{ fontSize: 13, color: "#94a3b8" }}>
                          {s.label}: {s.value} ({s.pct})
                        </div>
                      ))}
                      <button type="button" style={linkBtn} onClick={() => document.getElementById("work-orders")?.scrollIntoView({ behavior: "smooth" })}>
                        View all work orders →
                      </button>
                    </div>,
                  )}
                  {sectionCard(
                    "chart-priority",
                    "Work Orders by Priority",
                    <div style={{ height: 240 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart layout="vertical" data={priorityData} margin={{ left: 8, right: 8 }}>
                          <XAxis type="number" hide />
                          <YAxis type="category" dataKey="name" width={72} tick={{ fill: "#94a3b8", fontSize: 12 }} />
                          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155" }} />
                          <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                            {priorityData.map((e, i) => (
                              <Cell key={i} fill={PRIORITY_COLORS[e.name] || "#64748b"} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                      <button type="button" style={linkBtn} onClick={() => document.getElementById("work-orders")?.scrollIntoView({ behavior: "smooth" })}>
                        View all work orders →
                      </button>
                    </div>,
                  )}
                  {sectionCard(
                    "chart-cost",
                    "Maintenance Cost (MTD)",
                    <div style={{ height: 220 }}>
                      <div style={{ fontWeight: 800, marginBottom: 6 }}>${Number(k.totalCostMtd).toLocaleString()}</div>
                      <div style={{ color: "#94a3b8", marginBottom: 8 }}>{data.kpiMeta.maintenanceCostSubtext}</div>
                      <ResponsiveContainer width="100%" height="80%">
                        <LineChart data={costChartData}>
                          <XAxis dataKey="day" tick={{ fill: "#64748b", fontSize: 11 }} />
                          <YAxis hide domain={["auto", "auto"]} />
                          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155" }} />
                          <Line type="monotone" dataKey="amount" stroke="#a855f7" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                      <button type="button" style={linkBtn} onClick={() => setModal("report")}>
                        View full report →
                      </button>
                    </div>,
                  )}
                </div>

                {sectionCard(
                  "maintenance-calendar",
                  "Maintenance Calendar",
                  <>
                    <div style={{ fontWeight: 800, marginBottom: 8 }}>May 2025</div>
                    <CalendarMay2025 events={data.calendar.events} />
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 12 }}>
                      {(["PM_SCHEDULED", "INSPECTION", "DUE_TODAY", "OVERDUE"] as const).map((kind) => (
                        <div key={kind} style={{ fontSize: 13, color: "#cbd5e1" }}>
                          <span style={{ color: CAL_KIND[kind].color }}>●</span> {CAL_KIND[kind].label} (
                          {calendarLegend[kind] ?? 0})
                        </div>
                      ))}
                    </div>
                    <button type="button" style={{ ...linkBtn, marginTop: 12 }} onClick={() => setModal("calendar")}>
                      View full calendar →
                    </button>
                  </>,
                )}

                {sectionCard(
                  "environmental",
                  "Environmental Conditions",
                  <>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "4px 10px",
                        borderRadius: 999,
                        background: "rgba(34,197,94,0.15)",
                        color: "#86efac",
                        fontWeight: 800,
                        fontSize: 12,
                        marginBottom: 10,
                      }}
                    >
                      Live
                    </span>
                    {data.environment.map((row) => (
                      <div
                        key={row.id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 120px 140px 80px",
                          gap: 10,
                          alignItems: "center",
                          padding: "10px 0",
                          borderBottom: "1px solid rgba(51,65,85,0.5)",
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 700 }}>{row.label}</div>
                          <div style={{ fontSize: 12, color: "#64748b" }}>Ideal range: {row.idealRangeDisplay}</div>
                        </div>
                        <div style={{ fontWeight: 900 }}>{row.valueDisplay}</div>
                        <Sparkline values={row.sparkline as number[]} />
                        <span style={{ color: "#86efac", fontWeight: 800 }}>{row.statusLabel}</span>
                      </div>
                    ))}
                    <button type="button" style={{ ...linkBtn, marginTop: 12 }} onClick={() => setModal("env")}>
                      View environmental dashboard →
                    </button>
                  </>,
                )}

                {sectionCard(
                  "active-alerts",
                  "Active Alerts",
                  <>
                    {data.alerts.map((a) => (
                      <div key={a.id} style={{ padding: "10px 0", borderBottom: "1px solid rgba(51,65,85,0.5)" }}>
                        <div style={{ fontWeight: 800 }}>{a.title}</div>
                        <div style={{ color: "#94a3b8", fontSize: 13 }}>
                          Location: {a.locationLabel}
                          {a.valueLabel ? ` · Value: ${a.valueLabel}` : ""}
                          {a.statusLabel ? ` · Status: ${a.statusLabel}` : ""}
                        </div>
                        <div style={{ color: "#64748b", fontSize: 12 }}>{a.timeLabel}</div>
                      </div>
                    ))}
                    <button type="button" style={{ ...linkBtn, marginTop: 12 }} onClick={() => setModal("alerts")}>
                      View all alerts →
                    </button>
                  </>,
                )}

                {sectionCard(
                  "work-orders",
                  "Recent Work Orders",
                  <>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                      {["All", "In Progress", "Overdue", "Completed", "Scheduled", "On Hold"].map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setTab(t)}
                          style={{
                            padding: "6px 12px",
                            borderRadius: 999,
                            border: tab === t ? "1px solid #a855f7" : "1px solid rgba(71,85,105,0.6)",
                            background: tab === t ? "rgba(91,33,182,0.35)" : "rgba(2,6,23,0.5)",
                            color: tab === t ? "#e9d5ff" : "#94a3b8",
                            cursor: "pointer",
                            fontWeight: 700,
                          }}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                      <input
                        placeholder="Search work orders..."
                        value={tableSearch}
                        onChange={(e) => setTableSearch(e.target.value)}
                        style={{
                          flex: "1 1 200px",
                          padding: "8px 12px",
                          borderRadius: 10,
                          border: "1px solid rgba(148,163,184,0.25)",
                          background: "rgba(2,6,23,0.55)",
                          color: "#fff",
                        }}
                      />
                      <div style={{ position: "relative" }}>
                        <button type="button" style={secondaryBtn} onClick={() => setFilterOpen((v) => !v)}>
                          Filters
                        </button>
                        {filterOpen ? (
                          <div
                            style={{
                              position: "absolute",
                              right: 0,
                              top: 40,
                              zIndex: 30,
                              background: "rgba(15,23,42,0.98)",
                              border: "1px solid rgba(148,163,184,0.35)",
                              borderRadius: 12,
                              padding: 12,
                              width: 260,
                              display: "grid",
                              gap: 8,
                            }}
                          >
                            <label style={lbl}>
                              Category
                              <input
                                style={inp}
                                value={filters.category}
                                onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
                              />
                            </label>
                            <label style={lbl}>
                              Priority
                              <input
                                style={inp}
                                value={filters.priority}
                                onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}
                              />
                            </label>
                            <label style={lbl}>
                              Status
                              <input
                                style={inp}
                                value={filters.status}
                                onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
                              />
                            </label>
                            <label style={lbl}>
                              Assigned To
                              <input
                                style={inp}
                                value={filters.assignedTo}
                                onChange={(e) => setFilters((f) => ({ ...f, assignedTo: e.target.value }))}
                              />
                            </label>
                            <button
                              type="button"
                              style={secondaryBtn}
                              onClick={() => setFilters({ category: "", priority: "", status: "", assignedTo: "" })}
                            >
                              Clear
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 900 }}>
                        <thead>
                          <tr style={{ color: "#94a3b8", textAlign: "left" }}>
                            {["ID", "Title", "Location", "Category", "Priority", "Status", "Assigned To", "Due Date", ""].map(
                              (h) => (
                                <th key={h} style={{ padding: "8px 6px", borderBottom: "1px solid rgba(71,85,105,0.6)" }}>
                                  {h}
                                </th>
                              ),
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredRows.map((w) => (
                            <tr key={w.id}>
                              <td style={td}>{w.externalId}</td>
                              <td style={td}>{w.title}</td>
                              <td style={td}>{w.location}</td>
                              <td style={td}>{w.category}</td>
                              <td style={td}>
                                <Badge text={w.priority} color={PRIORITY_COLORS[w.priority] || "#64748b"} />
                              </td>
                              <td style={td}>
                                <Badge text={w.status} color={STATUS_COLORS[w.status] || "#64748b"} />
                              </td>
                              <td style={td}>{w.assignedTo}</td>
                              <td style={td}>
                                {new Date(w.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                                {w.dueMeta ? ` — ${w.dueMeta}` : ""}
                              </td>
                              <td style={td}>
                                <button
                                  type="button"
                                  style={{ ...linkBtn, padding: 0 }}
                                  onClick={async () => {
                                    if (!confirm(`Delete ${w.externalId}?`)) return;
                                    await deleteFacilityWorkOrder(w.id);
                                    void load();
                                  }}
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button type="button" style={{ ...linkBtn, marginTop: 12 }} onClick={() => document.getElementById("work-orders")?.scrollIntoView()}>
                      View all work orders →
                    </button>
                  </>,
                )}

                <div id="preventive-maintenance" style={{ scrollMarginTop: 96 }} />
                {sectionCard(
                  "pm-list",
                  "Preventive Maintenance",
                  <>
                    {data.pmTasks.length === 0 ? (
                      emptyBlock("No PM tasks in the table yet.")
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: 18, color: "#cbd5e1" }}>
                        {data.pmTasks.map((t) => (
                          <li key={t.id}>
                            {t.taskName} — {t.assetSystem} — next {new Date(t.nextDueDate).toLocaleDateString()}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>,
                )}

                <div id="assets" style={{ scrollMarginTop: 96 }} />
                {sectionCard(
                  "assets-list",
                  "Assets",
                  <>
                    {data.assets.length === 0 ? (
                      emptyBlock("No saved assets yet.")
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: 18, color: "#cbd5e1" }}>
                        {data.assets.map((a) => (
                          <li key={a.id}>
                            {a.assetName} — {a.category} @ {a.location}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>,
                )}

                <div id="locations" style={{ scrollMarginTop: 96 }} />
                {sectionCard(
                  "locations-list",
                  "Locations",
                  <>
                    {data.locations.length === 0 ? (
                      emptyBlock("No saved locations yet.")
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: 18, color: "#cbd5e1" }}>
                        {data.locations.map((l) => (
                          <li key={l.id}>
                            {l.locationName} ({l.locationType}) — {l.parentArea}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>,
                )}

                <div id="requests" style={{ scrollMarginTop: 96 }} />
                {sectionCard(
                  "requests-list",
                  "Requests",
                  <>
                    {data.partRequests.length === 0 ? (
                      emptyBlock("No part requests yet.")
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: 18, color: "#cbd5e1" }}>
                        {data.partRequests.map((p) => (
                          <li key={p.id}>
                            {p.partName} ×{p.quantity}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>,
                )}

                <div id="facility-rooms" style={{ scrollMarginTop: 96 }} />
                {sectionCard("rooms", "Rooms / Areas", <>{emptyBlock("See Facility Overview for room counts.")}</>)}
                <div id="utilities" style={{ scrollMarginTop: 96 }} />
                {sectionCard("utilities", "Utilities (Live)", <>{emptyBlock("Utility telemetry is summarized under Environmental Conditions.")}</>)}
                <div id="environmental" style={{ scrollMarginTop: 96 }} />
                {sectionCard("env-anchor", "Environmental (Live)", <>{emptyBlock("Scroll to Environmental Conditions for live readings.")}</>)}
                <div id="access-control" style={{ scrollMarginTop: 96 }} />
                {sectionCard("access", "Access Control", <>{emptyBlock("No access events recorded in this module yet.")}</>)}
                <div id="compliance" style={{ scrollMarginTop: 96 }} />
                {sectionCard("compliance", "Compliance", <>{emptyBlock("No compliance tasks beyond PM and work orders.")}</>)}

                <div id="inventory-parts" style={{ scrollMarginTop: 96 }} />
                {sectionCard("inv-parts", "Parts & Inventory", <>{emptyBlock("Request parts with Quick Actions.")}</>)}
                <div id="vendors" style={{ scrollMarginTop: 96 }} />
                {sectionCard("vendors", "Vendors", <>{emptyBlock("No vendor records for this module yet.")}</>)}
                <div id="purchase-orders" style={{ scrollMarginTop: 96 }} />
                {sectionCard("po", "Purchase Orders", <>{emptyBlock("No purchase orders yet.")}</>)}

                <div id="documents-sops" style={{ scrollMarginTop: 96 }} />
                {sectionCard("sops", "SOPs & Manuals", <>{emptyBlock("No documents uploaded here yet.")}</>)}
                <div id="documents-reports" style={{ scrollMarginTop: 96 }} />
                {sectionCard("reports", "Reports", <>{emptyBlock("Generate a report from Quick Actions.")}</>)}
                <div id="documents-files" style={{ scrollMarginTop: 96 }} />
                {sectionCard("files", "Files", <>{emptyBlock("No files attached yet.")}</>)}

                <div id="settings-categories" style={{ scrollMarginTop: 96 }} />
                {sectionCard("cat", "Categories", <>{emptyBlock("Categories are managed with work order categories in each form.")}</>)}
                <div id="settings-teams" style={{ scrollMarginTop: 96 }} />
                {sectionCard(
                  "teams",
                  "Teams",
                  <>
                    {canAdminTeams ? (
                      <Link href="/admin" style={{ color: "#a5b4fc", fontWeight: 800 }}>
                        Open Company Admin (staff & invites) →
                      </Link>
                    ) : (
                      <div style={{ color: "#94a3b8" }}>
                        Company Owner or Company Admin manages staff and invites from Admin → User Access.
                      </div>
                    )}
                  </>,
                )}
                <div id="settings-alerts" style={{ scrollMarginTop: 96 }} />
                {sectionCard("sett-alerts", "Alerts settings", <>{emptyBlock("Alert delivery rules are not configured in this preview.")}</>)}
                <div id="settings-general" style={{ scrollMarginTop: 96 }} />
                {sectionCard("sett-gen", "Settings", <>{emptyBlock("Workspace settings remain under Admin → Company config.")}</>)}

                {sectionCard(
                  "quick-actions",
                  "Quick Actions",
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    <button type="button" style={secondaryBtn} onClick={() => setModal("wo")}>
                      Create Work Order
                    </button>
                    <button type="button" style={secondaryBtn} onClick={() => setModal("pm")}>
                      Create PM Task
                    </button>
                    <button type="button" style={secondaryBtn} onClick={() => setModal("asset")}>
                      Add Asset
                    </button>
                    <button type="button" style={secondaryBtn} onClick={() => setModal("parts")}>
                      Request Parts
                    </button>
                    <button type="button" style={secondaryBtn} onClick={() => setModal("loc")}>
                      Add Location
                    </button>
                    <button type="button" style={secondaryBtn} onClick={() => setModal("report")}>
                      Generate Report
                    </button>
                  </div>,
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {modal ? (
        <div style={modalOverlay} onClick={() => setModal(null)}>
          <div style={modalBox} onClick={(e) => e.stopPropagation()}>
            <ModalBody
              kind={modal}
              data={data}
              onClose={() => setModal(null)}
              onSaved={async () => {
                await load();
                setModal(null);
              }}
            />
          </div>
        </div>
      ) : null}
    </main>
  );
}

function ModalBody({
  kind,
  data,
  onClose,
  onSaved,
}: {
  kind: string;
  data: FacilityDashboardJson | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  if (kind === "systems" && data) {
    return (
      <>
        <h3 style={{ marginTop: 0 }}>All systems</h3>
        {data.systems.map((s) => (
          <div key={s.id} style={{ marginBottom: 8 }}>
            {s.name}: <strong style={{ color: "#86efac" }}>{s.status}</strong>
          </div>
        ))}
        <button type="button" style={secondaryBtn} onClick={onClose}>
          Close
        </button>
      </>
    );
  }
  if (kind === "calendar" && data) {
    return (
      <>
        <h3 style={{ marginTop: 0 }}>Full calendar — May 2025</h3>
        <CalendarMay2025 events={data.calendar.events} />
        <button type="button" style={{ ...secondaryBtn, marginTop: 12 }} onClick={onClose}>
          Close
        </button>
      </>
    );
  }
  if (kind === "env" && data) {
    return (
      <>
        <h3 style={{ marginTop: 0 }}>Environmental dashboard</h3>
        {data.environment.map((row) => (
          <div key={row.id} style={{ marginBottom: 10 }}>
            <strong>{row.label}</strong>: {row.valueDisplay} (ideal {row.idealRangeDisplay})
          </div>
        ))}
        <button type="button" style={secondaryBtn} onClick={onClose}>
          Close
        </button>
      </>
    );
  }
  if (kind === "alerts" && data) {
    return (
      <>
        <h3 style={{ marginTop: 0 }}>All alerts</h3>
        {data.alerts.map((a) => (
          <div key={a.id} style={{ marginBottom: 10 }}>
            <strong>{a.title}</strong> — {a.locationLabel} — {a.timeLabel}
          </div>
        ))}
        <button type="button" style={secondaryBtn} onClick={onClose}>
          Close
        </button>
      </>
    );
  }
  if (kind === "report" && data) {
    const kk = data.kpis;
    return (
      <>
        <h3 style={{ marginTop: 0 }}>Report</h3>
        <div>Total Work Orders: {kk.totalWorkOrders}</div>
        <div>Completed: {kk.completed}</div>
        <div>In Progress: {kk.inProgress}</div>
        <div>Overdue: {kk.overdue}</div>
        <div>PM Compliance: {kk.pmCompliancePct}%</div>
        <div>Total Cost MTD: ${Number(kk.totalCostMtd).toLocaleString()}</div>
        <button type="button" style={{ ...secondaryBtn, marginTop: 12 }} onClick={onClose}>
          Close
        </button>
      </>
    );
  }
  if (kind === "wo") return <WorkOrderForm onClose={onClose} onSaved={onSaved} />;
  if (kind === "pm") return <PmForm onClose={onClose} onSaved={onSaved} />;
  if (kind === "asset") return <AssetForm onClose={onClose} onSaved={onSaved} />;
  if (kind === "parts") return <PartsForm onClose={onClose} onSaved={onSaved} />;
  if (kind === "loc") return <LocForm onClose={onClose} onSaved={onSaved} />;
  return null;
}

function WorkOrderForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [status, setStatus] = useState("In Progress");
  const [assignedTo, setAssignedTo] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <h3 style={{ marginTop: 0 }}>Create work order</h3>
      {err ? <div style={{ color: "#fecaca", marginBottom: 8 }}>{err}</div> : null}
      <label style={lbl}>
        Title
        <input style={inp} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label style={lbl}>
        Location
        <input style={inp} value={location} onChange={(e) => setLocation(e.target.value)} />
      </label>
      <label style={lbl}>
        Category
        <input style={inp} value={category} onChange={(e) => setCategory(e.target.value)} />
      </label>
      <label style={lbl}>
        Priority
        <select style={inp} value={priority} onChange={(e) => setPriority(e.target.value)}>
          {["High", "Medium", "Low", "None"].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label style={lbl}>
        Status
        <select style={inp} value={status} onChange={(e) => setStatus(e.target.value)}>
          {["In Progress", "Overdue", "Completed", "Scheduled", "On Hold"].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label style={lbl}>
        Assigned To
        <input style={inp} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} />
      </label>
      <label style={lbl}>
        Due Date
        <input style={inp} type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </label>
      <label style={lbl}>
        Description
        <textarea style={{ ...inp, minHeight: 80 }} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="button" style={secondaryBtn} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          style={primaryBtn}
          onClick={async () => {
            setErr(null);
            try {
              if (!dueDate) throw new Error("Due date required");
              await postFacilityWorkOrder({
                title,
                location,
                category,
                priority,
                status,
                assignedTo,
                dueDate: new Date(dueDate).toISOString(),
                description,
              });
              await onSaved();
            } catch (e: unknown) {
              setErr(e instanceof Error ? e.message : "Save failed");
            }
          }}
        >
          Save
        </button>
      </div>
    </>
  );
}

function PmForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [taskName, setTaskName] = useState("");
  const [assetSystem, setAssetSystem] = useState("");
  const [frequency, setFrequency] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [nextDueDate, setNextDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <h3 style={{ marginTop: 0 }}>Create PM task</h3>
      {err ? <div style={{ color: "#fecaca" }}>{err}</div> : null}
      <label style={lbl}>
        Task Name
        <input style={inp} value={taskName} onChange={(e) => setTaskName(e.target.value)} />
      </label>
      <label style={lbl}>
        Asset/System
        <input style={inp} value={assetSystem} onChange={(e) => setAssetSystem(e.target.value)} />
      </label>
      <label style={lbl}>
        Frequency
        <input style={inp} value={frequency} onChange={(e) => setFrequency(e.target.value)} />
      </label>
      <label style={lbl}>
        Assigned To
        <input style={inp} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} />
      </label>
      <label style={lbl}>
        Next Due Date
        <input style={inp} type="date" value={nextDueDate} onChange={(e) => setNextDueDate(e.target.value)} />
      </label>
      <label style={lbl}>
        Notes
        <textarea style={{ ...inp, minHeight: 70 }} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="button" style={secondaryBtn} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          style={primaryBtn}
          onClick={async () => {
            setErr(null);
            try {
              await postFacilityPmTask({
                taskName,
                assetSystem,
                frequency,
                assignedTo,
                nextDueDate: nextDueDate ? new Date(nextDueDate).toISOString() : "",
                notes,
              });
              await onSaved();
            } catch (e: unknown) {
              setErr(e instanceof Error ? e.message : "Save failed");
            }
          }}
        >
          Save
        </button>
      </div>
    </>
  );
}

function AssetForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [assetName, setAssetName] = useState("");
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [installDate, setInstallDate] = useState("");
  const [status, setStatus] = useState("Active");
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <h3 style={{ marginTop: 0 }}>Add asset</h3>
      {err ? <div style={{ color: "#fecaca" }}>{err}</div> : null}
      <label style={lbl}>
        Asset Name
        <input style={inp} value={assetName} onChange={(e) => setAssetName(e.target.value)} />
      </label>
      <label style={lbl}>
        Category
        <input style={inp} value={category} onChange={(e) => setCategory(e.target.value)} />
      </label>
      <label style={lbl}>
        Location
        <input style={inp} value={location} onChange={(e) => setLocation(e.target.value)} />
      </label>
      <label style={lbl}>
        Serial Number
        <input style={inp} value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} />
      </label>
      <label style={lbl}>
        Install Date
        <input style={inp} type="date" value={installDate} onChange={(e) => setInstallDate(e.target.value)} />
      </label>
      <label style={lbl}>
        Status
        <input style={inp} value={status} onChange={(e) => setStatus(e.target.value)} />
      </label>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="button" style={secondaryBtn} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          style={primaryBtn}
          onClick={async () => {
            setErr(null);
            try {
              await postFacilityAsset({
                assetName,
                category,
                location,
                serialNumber,
                installDate: installDate ? new Date(installDate).toISOString() : new Date().toISOString(),
                status,
              });
              await onSaved();
            } catch (e: unknown) {
              setErr(e instanceof Error ? e.message : "Save failed");
            }
          }}
        >
          Save
        </button>
      </div>
    </>
  );
}

function PartsForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [partName, setPartName] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [neededFor, setNeededFor] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <h3 style={{ marginTop: 0 }}>Request parts</h3>
      {err ? <div style={{ color: "#fecaca" }}>{err}</div> : null}
      <label style={lbl}>
        Part Name
        <input style={inp} value={partName} onChange={(e) => setPartName(e.target.value)} />
      </label>
      <label style={lbl}>
        Quantity
        <input style={inp} type="number" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
      </label>
      <label style={lbl}>
        Needed For
        <input style={inp} value={neededFor} onChange={(e) => setNeededFor(e.target.value)} />
      </label>
      <label style={lbl}>
        Priority
        <select style={inp} value={priority} onChange={(e) => setPriority(e.target.value)}>
          {["High", "Medium", "Low"].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label style={lbl}>
        Notes
        <textarea style={{ ...inp, minHeight: 70 }} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="button" style={secondaryBtn} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          style={primaryBtn}
          onClick={async () => {
            setErr(null);
            try {
              await postFacilityPartRequest({ partName, quantity, neededFor, priority, notes });
              await onSaved();
            } catch (e: unknown) {
              setErr(e instanceof Error ? e.message : "Save failed");
            }
          }}
        >
          Save
        </button>
      </div>
    </>
  );
}

function LocForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [locationName, setLocationName] = useState("");
  const [locationType, setLocationType] = useState("");
  const [parentArea, setParentArea] = useState("");
  const [sqFt, setSqFt] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <h3 style={{ marginTop: 0 }}>Add location</h3>
      {err ? <div style={{ color: "#fecaca" }}>{err}</div> : null}
      <label style={lbl}>
        Location Name
        <input style={inp} value={locationName} onChange={(e) => setLocationName(e.target.value)} />
      </label>
      <label style={lbl}>
        Location Type
        <input style={inp} value={locationType} onChange={(e) => setLocationType(e.target.value)} />
      </label>
      <label style={lbl}>
        Parent Area
        <input style={inp} value={parentArea} onChange={(e) => setParentArea(e.target.value)} />
      </label>
      <label style={lbl}>
        Sq Ft
        <input style={inp} value={sqFt} onChange={(e) => setSqFt(e.target.value)} />
      </label>
      <label style={lbl}>
        Notes
        <textarea style={{ ...inp, minHeight: 70 }} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="button" style={secondaryBtn} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          style={primaryBtn}
          onClick={async () => {
            setErr(null);
            try {
              await postFacilityLocation({
                locationName,
                locationType,
                parentArea,
                sqFt: sqFt ? Number(sqFt) : null,
                notes,
              });
              await onSaved();
            } catch (e: unknown) {
              setErr(e instanceof Error ? e.message : "Save failed");
            }
          }}
        >
          Save
        </button>
      </div>
    </>
  );
}

function KpiCard({ title, value, change, sub }: { title: string; value: string; change: string; sub: string }) {
  return (
    <div
      style={{
        background: "rgba(15,23,42,0.88)",
        border: "1px solid rgba(139,92,246,0.25)",
        borderRadius: 16,
        padding: 14,
      }}
    >
      <div style={{ color: "#94a3b8", fontSize: 12, fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 26, fontWeight: 950, marginTop: 6 }}>{value}</div>
      <div style={{ color: "#86efac", fontSize: 13, marginTop: 4 }}>{change}</div>
      <div style={{ color: "#64748b", fontSize: 12 }}>{sub}</div>
    </div>
  );
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 8px",
        borderRadius: 999,
        background: `${color}22`,
        border: `1px solid ${color}88`,
        color,
        fontWeight: 800,
        fontSize: 12,
      }}
    >
      {text}
    </span>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 120;
  const h = 36;
  if (!values.length) return <svg width={w} height={h} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 2;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1 || 1)) * (w - pad * 2);
    const y = pad + (1 - (v - min) / (max - min || 1)) * (h - pad * 2);
    return `${x},${y}`;
  });
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline fill="none" stroke="#a855f7" strokeWidth="2" points={pts.join(" ")} />
    </svg>
  );
}

function CalendarMay2025({ events }: { events: Array<{ day: number; kind: string }> }) {
  const byDay = new Map<number, string[]>();
  for (const e of events) {
    const arr = byDay.get(e.day) || [];
    arr.push(e.kind);
    byDay.set(e.day, arr);
  }
  const startDow = 4;
  const daysInMonth = 31;
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 4,
          fontSize: 11,
          color: "#64748b",
          marginBottom: 4,
        }}
      >
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} style={{ textAlign: "center" }}>
            {d}
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {cells.map((d, i) => (
          <div
            key={i}
            style={{
              minHeight: 44,
              borderRadius: 8,
              border: "1px solid rgba(51,65,85,0.5)",
              padding: 4,
              fontSize: 12,
              color: d ? "#e2e8f0" : "transparent",
              background: d ? "rgba(2,6,23,0.45)" : "transparent",
            }}
          >
            {d ? (
              <>
                <div style={{ fontWeight: 800 }}>{d}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 2, marginTop: 2 }}>
                  {(byDay.get(d) || []).map((k, j) => (
                    <span
                      key={j}
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 99,
                        background: CAL_KIND[k]?.color || "#64748b",
                        display: "inline-block",
                      }}
                    />
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

const td: React.CSSProperties = { padding: "8px 6px", borderBottom: "1px solid rgba(30,41,59,0.8)", verticalAlign: "top" };
const lbl: React.CSSProperties = { display: "grid", gap: 6, fontSize: 13, marginBottom: 10, color: "#cbd5e1" };
const inp: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid rgba(148,163,184,0.25)",
  background: "rgba(2,6,23,0.55)",
  color: "#fff",
};
const primaryBtn: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 12,
  border: "1px solid rgba(139,92,246,0.55)",
  background: "linear-gradient(135deg, rgba(91,33,182,0.55), rgba(30,41,59,0.95))",
  color: "#fff",
  fontWeight: 800,
  cursor: "pointer",
};
const secondaryBtn: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 12,
  border: "1px solid rgba(71,85,105,0.6)",
  background: "rgba(15,23,42,0.75)",
  color: "#e2e8f0",
  fontWeight: 700,
  cursor: "pointer",
};
const linkBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#a5b4fc",
  cursor: "pointer",
  fontWeight: 800,
  padding: "8px 0",
  textAlign: "left",
};
const iconBtn: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 12,
  border: "1px solid rgba(71,85,105,0.6)",
  background: "rgba(2,6,23,0.55)",
  cursor: "pointer",
};
const ddItem: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "8px 10px",
  border: "none",
  background: "transparent",
  color: "#e2e8f0",
  cursor: "pointer",
  borderRadius: 8,
};
