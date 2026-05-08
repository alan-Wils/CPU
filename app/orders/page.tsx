"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Fragment, useCallback, useEffect, useState } from "react";
import Nav from "@/components/Nav";
import PageAccessGate from "@/components/PageAccessGate";
import {
  fetchLeafLinkOrderDetail,
  fetchLeafLinkOrdersList,
  getSelectedCompanyId,
  syncLeafLinkOrders,
  type LeafLinkOrderCardDto,
  type LeafLinkOrderSummaryDto,
} from "@/lib/api";

function usd(n: number | null | undefined): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

function fmtDate(iso?: string | null): string {
  const s = typeof iso === "string" ? iso.trim() : "";
  if (!s) return "—";
  const t = Date.parse(s);
  if (!Number.isFinite(t))
    return s.length <= 22 ? s : `${s.slice(0, 22)}…`;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(t));
}

function statusStyles(label: string): { bg: string; border: string; color: string } {
  const k = String(label || "").toLowerCase();
  if (k.includes("submit") || k.includes("draft") || k.includes("backorder"))
    return { bg: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.45)", color: "#93c5fd" };
  if (k.includes("approv") || k.includes("accept"))
    return { bg: "rgba(168,85,247,0.12)", border: "rgba(168,85,247,0.45)", color: "#d8b4fe" };
  if (k.includes("fulfill"))
    return { bg: "rgba(234,179,8,0.12)", border: "rgba(234,179,8,0.45)", color: "#fde047" };
  if (k.includes("ship"))
    return { bg: "rgba(14,165,233,0.12)", border: "rgba(14,165,233,0.45)", color: "#7dd3fc" };
  if (k.includes("deliver") || k.includes("complete"))
    return { bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.45)", color: "#86efac" };
  if (k.includes("cancel") || k.includes("reject"))
    return { bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.45)", color: "#fecaca" };
  return { bg: "rgba(148,163,184,0.12)", border: "rgba(148,163,184,0.35)", color: "#cbd5e1" };
}

const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "submitted", label: "Submitted" },
  { value: "accepted", label: "Approved" },
  { value: "fulfilled", label: "Fulfilled" },
  { value: "shipped", label: "Shipped" },
  { value: "complete", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
  { value: "draft", label: "Draft" },
];

const shellStyle: React.CSSProperties = {
  minHeight: "100vh",
  padding: "24px 18px 48px",
  background:
    "radial-gradient(ellipse at top, rgba(91,33,182,0.35), transparent 55%), linear-gradient(180deg, #020617 0%, #0f172a 45%, #020617 100%)",
  color: "#e2e8f0",
};

const glassPanel: React.CSSProperties = {
  borderRadius: 22,
  border: "1px solid rgba(148, 163, 184, 0.22)",
  background: "linear-gradient(135deg, rgba(15,23,42,0.92), rgba(2,6,23,0.88))",
  boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
  padding: "22px 22px 26px",
};

const filterInputStyle: React.CSSProperties = {
  flex: "1 1 200px",
  minWidth: 160,
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(148,163,184,0.35)",
  background: "rgba(2,6,23,0.85)",
  color: "#e2e8f0",
  fontSize: 14,
};

const selectStyle: React.CSSProperties = {
  ...filterInputStyle,
  flex: "0 1 200px",
  cursor: "pointer",
};

const btnPrimary: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 12,
  border: "1px solid rgba(139,92,246,0.55)",
  background: "linear-gradient(135deg, rgba(91,33,182,0.75), rgba(76,29,149,0.85))",
  color: "#fff",
  fontWeight: 800,
  fontSize: 14,
  cursor: "pointer",
};

const btnGhost: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 12,
  border: "1px solid rgba(148,163,184,0.4)",
  background: "rgba(2,6,23,0.75)",
  color: "#cbd5e1",
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
};

const backdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.72)",
  zIndex: 1000,
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: 16,
  overflowY: "auto",
};

const modalPanelStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 860,
  marginTop: 24,
  marginBottom: 40,
  maxHeight: "none",
  background: "rgba(15, 23, 42, 0.98)",
  border: "1px solid rgba(148, 163, 184, 0.35)",
  borderRadius: 18,
  boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
  color: "#e2e8f0",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const stickyHeaderStyle: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 2,
  padding: "16px 20px 14px",
  borderBottom: "1px solid rgba(51,65,85,0.65)",
  background: "linear-gradient(180deg, rgba(15,23,42,0.98), rgba(15,23,42,0.92))",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
};

function OrderCard({
  order,
  onOpen,
}: {
  order: LeafLinkOrderCardDto;
  onOpen: (id: string) => void;
}) {
  const st = statusStyles(order.statusNormalized);
  return (
    <motion.button
      type="button"
      layout
      whileHover={{ y: -3, scale: 1.01 }}
      whileTap={{ scale: 0.995 }}
      transition={{ type: "spring", stiffness: 420, damping: 28 }}
      onClick={() => onOpen(order.id)}
      style={{
        textAlign: "left",
        cursor: "pointer",
        borderRadius: 18,
        border: "1px solid rgba(148,163,184,0.25)",
        background: "linear-gradient(145deg, rgba(30,41,59,0.65), rgba(15,23,42,0.92))",
        padding: "16px 16px 18px",
        boxShadow: "0 16px 40px rgba(0,0,0,0.35)",
        color: "inherit",
        width: "100%",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
        <div style={{ fontWeight: 900, fontSize: 17, color: "#f8fafc" }}>#{order.orderNumber}</div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: 0.4,
            padding: "4px 10px",
            borderRadius: 999,
            border: `1px solid ${st.border}`,
            background: st.bg,
            color: st.color,
          }}
        >
          {order.statusNormalized}
        </span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#cbd5e1", marginBottom: 10 }}>
        {order.customerName || "Customer"}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0,1fr))",
          gap: 8,
          fontSize: 13,
          color: "#94a3b8",
        }}
      >
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Total</div>
          <div style={{ color: "#e2e8f0", fontWeight: 700 }}>{usd(order.total)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Items</div>
          <div style={{ color: "#e2e8f0", fontWeight: 700 }}>{order.itemCount}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Ordered</div>
          <div style={{ color: "#e2e8f0" }}>{fmtDate(order.createdAt)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Delivery</div>
          <div style={{ color: "#e2e8f0" }}>{fmtDate(order.deliveryDate)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Sales rep</div>
          <div style={{ color: "#e2e8f0" }}>{order.salesRep.trim() ? order.salesRep : "—"}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Payment</div>
          <div style={{ color: "#e2e8f0" }}>{order.paymentStatus}</div>
        </div>
      </div>
    </motion.button>
  );
}

function SkeletonGrid() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 16,
      }}
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          style={{
            height: 212,
            borderRadius: 18,
            border: "1px solid rgba(148,163,184,0.14)",
            background: "linear-gradient(90deg, rgba(30,41,59,0.35) 25%, rgba(51,65,85,0.45) 50%, rgba(30,41,59,0.35) 75%)",
            backgroundSize: "200% 100%",
            animation: "cpu_orders_shimmer 1.2s ease-in-out infinite",
          }}
        />
      ))}
      <style>
        {`@keyframes cpu_orders_shimmer { 0%{background-position:-200% 0}100%{background-position:200% 0}}`}
      </style>
    </div>
  );
}

function OrderDetailBody({
  order,
  loading,
  errorMessage,
}: {
  order: LeafLinkOrderSummaryDto | null;
  loading: boolean;
  errorMessage: string;
}) {
  if (loading) {
    return (
      <div style={{ padding: 24, color: "#94a3b8", fontWeight: 600 }}>
        Loading order details from LeafLink…
      </div>
    );
  }
  if (errorMessage) {
    return (
      <div style={{ padding: 24, color: "#fecaca", fontWeight: 600 }}>
        {errorMessage}
      </div>
    );
  }
  if (!order) return null;

  const cust = order.customerName;
  const st = statusStyles(order.statusNormalized);

  return (
    <div style={{ padding: "10px 20px 22px", overflowY: "auto", flex: 1 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 800,
            textTransform: "uppercase",
            padding: "4px 10px",
            borderRadius: 999,
            border: `1px solid ${st.border}`,
            background: st.bg,
            color: st.color,
          }}
        >
          {order.statusNormalized}
        </span>
        <span style={{ fontSize: 13, color: "#94a3b8" }}>
          Payment: <b style={{ color: "#e2e8f0" }}>{order.paymentStatus}</b>
        </span>
        {order.classification ? (
          <span style={{ fontSize: 13, color: "#94a3b8" }}>
            Class: <b style={{ color: "#e2e8f0" }}>{order.classification}</b>
          </span>
        ) : null}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 14,
          marginBottom: 18,
        }}
      >
        <div style={{ padding: 12, borderRadius: 12, background: "rgba(2,6,23,0.55)", border: "1px solid rgba(51,65,85,0.55)" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#64748b", textTransform: "uppercase", marginBottom: 6 }}>
            Customer
          </div>
          <div style={{ fontWeight: 800, fontSize: 16, color: "#f1f5f9" }}>{cust || "—"}</div>
          {order.buyerCustomerId ? (
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>Buyer ID: {order.buyerCustomerId}</div>
          ) : null}
        </div>
        <div style={{ padding: 12, borderRadius: 12, background: "rgba(2,6,23,0.55)", border: "1px solid rgba(51,65,85,0.55)" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#64748b", textTransform: "uppercase", marginBottom: 6 }}>
            Schedule
          </div>
          <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 }}>
            <div>
              <span style={{ color: "#64748b" }}>Created:</span> {fmtDate(order.createdAt)}
            </div>
            <div>
              <span style={{ color: "#64748b" }}>Updated:</span> {fmtDate(order.updatedAt)}
            </div>
            <div>
              <span style={{ color: "#64748b" }}>Ship / delivery:</span> {fmtDate(order.shipDate || order.deliveryDate)}
            </div>
          </div>
        </div>
        <div style={{ padding: 12, borderRadius: 12, background: "rgba(2,6,23,0.55)", border: "1px solid rgba(51,65,85,0.55)" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#64748b", textTransform: "uppercase", marginBottom: 6 }}>
            People
          </div>
          <div style={{ fontSize: 14, color: "#e2e8f0" }}>
            Sales rep: <b>{order.salesRep.trim() ? order.salesRep : "—"}</b>
          </div>
          {order.paymentTerm ? (
            <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 6 }}>Terms: {order.paymentTerm}</div>
          ) : null}
        </div>
      </div>

      <div
        style={{
          padding: 14,
          borderRadius: 14,
          border: "1px solid rgba(51,65,85,0.55)",
          background: "rgba(2,6,23,0.45)",
          marginBottom: 18,
        }}
      >
        <div style={{ fontWeight: 900, fontSize: 15, marginBottom: 10, color: "#a5b4fc" }}>Totals</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, fontSize: 14 }}>
          <div>
            <span style={{ color: "#64748b" }}>Subtotal</span>
            <div style={{ fontWeight: 800 }}>{usd(order.subtotal)}</div>
          </div>
          <div>
            <span style={{ color: "#64748b" }}>Discount</span>
            <div style={{ fontWeight: 800 }}>
              {order.discount != null && order.discount !== 0
                ? `${order.discountType ? `${order.discountType} ` : ""}${usd(order.discount)}`
                : "—"}
            </div>
          </div>
          <div>
            <span style={{ color: "#64748b" }}>Tax</span>
            <div style={{ fontWeight: 800 }}>{usd(order.taxAmount ?? order.finalTaxAmount)}</div>
          </div>
          <div>
            <span style={{ color: "#64748b" }}>Shipping</span>
            <div style={{ fontWeight: 800 }}>{usd(order.shippingAmount)}</div>
          </div>
          <div>
            <span style={{ color: "#64748b" }}>Total</span>
            <div style={{ fontWeight: 900, color: "#f8fafc", fontSize: 18 }}>{usd(order.total)}</div>
          </div>
        </div>
      </div>

      {(order.notes || order.internalNotes) && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 900, marginBottom: 8, color: "#a5b4fc" }}>Notes</div>
          {order.notes ? (
            <div style={{ fontSize: 14, color: "#cbd5e1", whiteSpace: "pre-wrap", marginBottom: 8 }}>{order.notes}</div>
          ) : null}
          {order.internalNotes ? (
            <div style={{ fontSize: 13, color: "#94a3b8", whiteSpace: "pre-wrap" }}>
              <span style={{ fontWeight: 800, color: "#64748b" }}>Internal: </span>
              {order.internalNotes}
            </div>
          ) : null}
        </div>
      )}

      {(order.deliveryPreferences || order.shippingDetails) && (
        <div style={{ marginBottom: 16, fontSize: 14, color: "#cbd5e1" }}>
          <div style={{ fontWeight: 900, marginBottom: 6, color: "#a5b4fc" }}>Delivery &amp; shipping</div>
          {order.deliveryPreferences ? <div style={{ marginBottom: 6 }}>{order.deliveryPreferences}</div> : null}
          {order.shippingDetails ? <div style={{ color: "#94a3b8" }}>{order.shippingDetails}</div> : null}
        </div>
      )}

      <div style={{ fontWeight: 900, marginBottom: 10, color: "#a5b4fc" }}>Line items</div>
      <div style={{ borderRadius: 12, border: "1px solid rgba(51,65,85,0.55)", overflow: "hidden" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 0.8fr 0.5fr 0.7fr 0.7fr",
            gap: 8,
            padding: "10px 12px",
            background: "rgba(15,23,42,0.9)",
            fontSize: 11,
            fontWeight: 800,
            color: "#64748b",
            textTransform: "uppercase",
          }}
        >
          <span>Product</span>
          <span>SKU</span>
          <span>Qty</span>
          <span>Unit</span>
          <span>Line</span>
        </div>
        {order.lineItems.length === 0 ? (
          <div style={{ padding: 16, color: "#94a3b8" }}>No line items returned for this order.</div>
        ) : (
          order.lineItems.map((li) => (
            <div
              key={li.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1.4fr 0.8fr 0.5fr 0.7fr 0.7fr",
                gap: 8,
                padding: "10px 12px",
                borderTop: "1px solid rgba(51,65,85,0.45)",
                fontSize: 13,
              }}
            >
              <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{li.productName}</span>
              <span style={{ color: "#94a3b8" }}>{li.sku || "—"}</span>
              <span>{li.quantity}</span>
              <span>{li.unitPrice != null ? usd(li.unitPrice) : "—"}</span>
              <span style={{ fontWeight: 700 }}>{li.lineTotal != null ? usd(li.lineTotal) : "—"}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function OrdersPage() {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [page, setPage] = useState(1);
  const pageSize = 24;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [listPayload, setListPayload] = useState<Awaited<ReturnType<typeof fetchLeafLinkOrdersList>> | null>(null);

  const [syncing, setSyncing] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailKey, setDetailKey] = useState<string>("");
  const [detailOrder, setDetailOrder] = useState<LeafLinkOrderSummaryDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), 420);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status, sort]);

  const loadList = useCallback(
    async (opts?: { refresh?: boolean }) => {
      setLoading(true);
      setError("");
      try {
        const cid = getSelectedCompanyId().trim();
        const out = await fetchLeafLinkOrdersList({
          companyId: cid || undefined,
          page,
          pageSize,
          status: status === "all" ? undefined : status,
          sort,
          search: debouncedSearch || undefined,
          refresh: Boolean(opts?.refresh),
        });
        setListPayload(out);
      }
      catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Could not load orders.");
      }
      finally {
        setLoading(false);
      }
    },
    [page, pageSize, status, sort, debouncedSearch],
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const onRefresh = useCallback(() => {
    void loadList({ refresh: true });
  }, [loadList]);

  const onWarmSync = useCallback(async () => {
    setSyncing(true);
    setError("");
    try {
      const cid = getSelectedCompanyId().trim();
      await syncLeafLinkOrders(cid || undefined);
      await loadList({ refresh: true });
    }
    catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Sync failed.");
    }
    finally {
      setSyncing(false);
    }
  }, [companyId, loadList]);

  const openDetail = useCallback((id: string) => {
    setDetailKey(id);
    setDetailOrder(null);
    setDetailError("");
    setDetailOpen(true);
  }, []);

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setDetailKey("");
    setDetailOrder(null);
    setDetailError("");
  }, []);

  useEffect(() => {
    if (!detailOpen || !detailKey) return;
    let cancelled = false;
    (async () => {
      setDetailLoading(true);
      setDetailError("");
      try {
        const cid = getSelectedCompanyId().trim();
        const out = await fetchLeafLinkOrderDetail(detailKey, cid || undefined);
        if (!cancelled)
          setDetailOrder(out.order);
      }
      catch (e: unknown) {
        if (!cancelled)
          setDetailError(e instanceof Error ? e.message : "Could not load order.");
      }
      finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detailOpen, detailKey]);

  useEffect(() => {
    if (!detailOpen) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") closeDetail();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailOpen, closeDetail]);

  const orders = listPayload?.orders ?? [];
  const configured = listPayload?.configured ?? false;
  const integrationOn = listPayload?.integrationEnabled ?? false;
  const needsSetup = !configured || !integrationOn;
  const empty = !loading && !error && !needsSetup && orders.length === 0;

  return (
    <PageAccessGate permission="page.orders">
      <div style={shellStyle}>
        <Nav />
        <div style={{ maxWidth: 1240, margin: "0 auto" }}>
          <div style={{ marginBottom: 18 }}>
            <h1 style={{ margin: 0, fontSize: 32, fontWeight: 900, color: "#f8fafc" }}>Orders</h1>
            <p style={{ margin: "8px 0 0", fontSize: 15, color: "#94a3b8", maxWidth: 720, lineHeight: 1.5 }}>
              Current LeafLink wholesale orders for the selected company. Data is read live from LeafLink using secure
              credentials stored in company config (API keys never leave the server).
            </p>
          </div>

          <div style={glassPanel}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <input
                type="search"
                placeholder="Search order # or customer (2+ chars)"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                style={filterInputStyle}
                aria-label="Search orders"
              />
              <select value={status} onChange={(e) => setStatus(e.target.value)} style={selectStyle}>
                {STATUS_FILTER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select value={sort} onChange={(e) => setSort(e.target.value as "newest" | "oldest")} style={selectStyle}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
              <button type="button" style={btnPrimary} onClick={() => void onRefresh()} disabled={loading || syncing}>
                {loading ? "Refreshing…" : "Refresh"}
              </button>
              <button type="button" style={btnGhost} onClick={() => void onWarmSync()} disabled={loading || syncing || needsSetup}>
                {syncing ? "Syncing…" : "Multi-page sync"}
              </button>
              {listPayload?.fromCache ? (
                <span style={{ fontSize: 12, color: "#64748b", marginLeft: 4 }}>Served from short cache</span>
              ) : null}
            </div>

            {listPayload?.lastFetchedAt ? (
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 14 }}>
                Last fetched: {fmtDate(listPayload.lastFetchedAt)}
                {typeof listPayload.totalCount === "number" ? ` · ${listPayload.totalCount} orders in view` : null}
              </div>
            ) : null}

            {needsSetup && (
              <div
                style={{
                  padding: 18,
                  borderRadius: 14,
                  border: "1px dashed rgba(148,163,184,0.45)",
                  background: "rgba(2,6,23,0.55)",
                  marginBottom: 16,
                }}
              >
                <div style={{ fontWeight: 900, fontSize: 17, color: "#f8fafc", marginBottom: 8 }}>
                  LeafLink integration not configured
                </div>
                <p style={{ margin: 0, fontSize: 14, color: "#94a3b8", lineHeight: 1.6, maxWidth: 720 }}>
                  Turn on LeafLink in company config, add your seller company ID or slug, and store an API key. Owner /
                  Admin / Operations roles can edit these settings.
                </p>
                <div style={{ marginTop: 14 }}>
                  <Link href="/admin" style={{ ...btnPrimary, display: "inline-flex", textDecoration: "none" }}>
                    Open Company Config
                  </Link>
                </div>
              </div>
            )}

            {error ? (
              <div
                style={{
                  padding: 16,
                  borderRadius: 14,
                  border: "1px solid rgba(248,113,113,0.45)",
                  background: "rgba(127,29,29,0.25)",
                  color: "#fecaca",
                  marginBottom: 16,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ fontWeight: 700 }}>{error}</span>
                <button type="button" style={btnGhost} onClick={() => void loadList({ refresh: true })}>
                  Retry
                </button>
              </div>
            ) : null}

            {loading ? <SkeletonGrid /> : null}

            {empty ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "36px 16px",
                  borderRadius: 16,
                  border: "1px solid rgba(51,65,85,0.55)",
                  background: "rgba(2,6,23,0.45)",
                  color: "#94a3b8",
                  fontWeight: 600,
                }}
              >
                No wholesale orders match the current filters. Adjust status, search, or refresh from LeafLink.
              </div>
            ) : null}

            {!loading && !empty && !needsSetup ? (
              <Fragment>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                    gap: 16,
                  }}
                >
                  {orders.map((o) => (
                    <OrderCard key={`${o.id}:${o.orderNumber}`} order={o} onOpen={openDetail} />
                  ))}
                </div>
                {(listPayload?.hasPrevious || listPayload?.hasNext) && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      gap: 12,
                      marginTop: 22,
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      type="button"
                      style={btnGhost}
                      disabled={!listPayload?.hasPrevious}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Previous page
                    </button>
                    <div style={{ alignSelf: "center", fontSize: 13, color: "#94a3b8", fontWeight: 700 }}>
                      Page {listPayload?.page ?? page}
                    </div>
                    <button
                      type="button"
                      style={btnGhost}
                      disabled={!listPayload?.hasNext}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next page
                    </button>
                  </div>
                )}
              </Fragment>
            ) : null}
          </div>
        </div>

        <AnimatePresence>
          {detailOpen ? (
            <motion.div
              key="orders-detail"
              style={backdropStyle}
              role="presentation"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) closeDetail();
              }}
            >
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-labelledby="order-detail-title"
                style={modalPanelStyle}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 18 }}
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div style={stickyHeaderStyle}>
                  <div>
                    <div id="order-detail-title" style={{ margin: 0, fontSize: 22, fontWeight: 900, color: "#a5b4fc" }}>
                      Order #{detailKey}
                    </div>
                    <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
                      Full detail from LeafLink (line items, taxes, notes).
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={closeDetail}
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
                <OrderDetailBody order={detailOrder} loading={detailLoading} errorMessage={detailError} />
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </PageAccessGate>
  );
}
