"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import MarketplaceOrderInvoiceModal from "@/components/MarketplaceOrderInvoiceModal";
import { salesSellerOrders, salesSellerOrderSetStatus } from "@/lib/api";

type OrderRow = {
  id: string;
  status: string;
  total: number;
  createdAt: string;
  buyerCompany?: { name: string; slug: string };
};

export default function SellerOrdersPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [invoiceOrderId, setInvoiceOrderId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr("");
    setLoading(true);
    try {
      const res = await salesSellerOrders(
        statusFilter === "ALL" || statusFilter === "" ? "ALL" : statusFilter,
      );
      setOrders((res.orders || []) as OrderRow[]);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not load orders.");
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => {
      const buyer = o.buyerCompany?.name?.toLowerCase() || "";
      return o.id.toLowerCase().includes(q) || buyer.includes(q);
    });
  }, [orders, search]);

  async function setStatus(orderId: string, status: "ACCEPTED" | "REJECTED" | "FULFILLED" | "CANCELLED") {
    setBusyId(orderId);
    setErr("");
    try {
      await salesSellerOrderSetStatus(orderId, status);
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: "#f8fafc" }}>Orders</h1>
        <p style={{ margin: "10px 0 0", color: "#94a3b8", maxWidth: 640, lineHeight: 1.55 }}>
          NexBatch wholesale marketplace orders placed with your company. LeafLink-sourced POs remain in the Orders workspace unless mirrored here as marketplace orders.
        </p>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 18, alignItems: "center" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, fontWeight: 700, color: "#94a3b8" }}>
          Status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid rgba(51,65,85,0.65)",
              background: "rgba(15,23,42,0.9)",
              color: "#e2e8f0",
              fontWeight: 600,
            }}
          >
            <option value="ALL">All</option>
            <option value="PENDING">Pending</option>
            <option value="ACCEPTED">Accepted</option>
            <option value="FULFILLED">Fulfilled</option>
            <option value="REJECTED">Rejected</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </label>
        <label style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 6, fontSize: 12, fontWeight: 700, color: "#94a3b8" }}>
          Search
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Order id or customer…"
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid rgba(51,65,85,0.65)",
              background: "rgba(15,23,42,0.9)",
              color: "#e2e8f0",
            }}
          />
        </label>
      </div>

      {err ? (
        <div style={{ padding: 14, borderRadius: 12, border: "1px solid rgba(248,113,113,0.45)", color: "#fecaca", marginBottom: 14 }}>
          {err}
        </div>
      ) : null}

      {loading ? (
        <div style={{ color: "#93c5fd" }}>Loading orders…</div>
      ) : (
        <div style={{ overflowX: "auto", borderRadius: 16, border: "1px solid rgba(51,65,85,0.55)", background: "rgba(15,23,42,0.75)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#94a3b8", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                <th style={{ padding: "14px 16px" }}>Order</th>
                <th style={{ padding: "14px 16px" }}>Customer</th>
                <th style={{ padding: "14px 16px" }}>Total</th>
                <th style={{ padding: "14px 16px" }}>Source</th>
                <th style={{ padding: "14px 16px" }}>Status</th>
                <th style={{ padding: "14px 16px" }}>Invoice</th>
                <th style={{ padding: "14px 16px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id} style={{ borderTop: "1px solid rgba(51,65,85,0.45)" }}>
                  <td style={{ padding: "14px 16px", fontWeight: 800, color: "#f8fafc" }}>
                    #NB-{o.id.slice(-6).toUpperCase()}
                  </td>
                  <td style={{ padding: "14px 16px", color: "#cbd5e1" }}>{o.buyerCompany?.name || "—"}</td>
                  <td style={{ padding: "14px 16px", fontWeight: 800, color: "#e2e8f0" }}>
                    {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(o.total)}
                  </td>
                  <td style={{ padding: "14px 16px" }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 900,
                        padding: "4px 8px",
                        borderRadius: 999,
                        border: "1px solid rgba(167,139,250,0.45)",
                        color: "#e9d5ff",
                      }}
                    >
                      NexBatch
                    </span>
                  </td>
                  <td style={{ padding: "14px 16px", fontWeight: 800, color: "#cbd5e1" }}>{o.status}</td>
                  <td style={{ padding: "14px 16px" }}>
                    <button
                      type="button"
                      onClick={() => setInvoiceOrderId(o.id)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 10,
                        border: "1px solid rgba(34,211,238,0.45)",
                        background: "rgba(8,47,73,0.45)",
                        color: "#bae6fd",
                        fontWeight: 800,
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      Open
                    </button>
                  </td>
                  <td style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {o.status === "PENDING" ? (
                        <>
                          <button
                            type="button"
                            disabled={busyId === o.id}
                            onClick={() => void setStatus(o.id, "ACCEPTED")}
                            style={btnOk}
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            disabled={busyId === o.id}
                            onClick={() => void setStatus(o.id, "REJECTED")}
                            style={btnGhost}
                          >
                            Reject
                          </button>
                        </>
                      ) : null}
                      {o.status === "ACCEPTED" ? (
                        <>
                          <button
                            type="button"
                            disabled={busyId === o.id}
                            onClick={() => void setStatus(o.id, "FULFILLED")}
                            style={btnOk}
                          >
                            Fulfill
                          </button>
                          <button
                            type="button"
                            disabled={busyId === o.id}
                            onClick={() => void setStatus(o.id, "CANCELLED")}
                            style={btnGhost}
                          >
                            Cancel
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 ? (
            <div style={{ padding: 24, color: "#64748b", textAlign: "center" }}>No orders match your filters.</div>
          ) : null}
        </div>
      )}

      <p style={{ marginTop: 18, fontSize: 13, color: "#64748b" }}>
        Need LeafLink purchase orders?{" "}
        <Link href="/orders" style={{ color: "#67e8f9", fontWeight: 700 }}>
          Open Orders workspace
        </Link>
        .
      </p>

      <MarketplaceOrderInvoiceModal
        open={invoiceOrderId !== null}
        onClose={() => setInvoiceOrderId(null)}
        orderId={invoiceOrderId}
        role="seller"
      />
    </div>
  );
}

const btnOk: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid rgba(34,197,94,0.45)",
  background: "rgba(6,78,59,0.45)",
  color: "#bbf7d0",
  fontWeight: 800,
  cursor: "pointer",
};

const btnGhost: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid rgba(148,163,184,0.35)",
  background: "rgba(15,23,42,0.65)",
  color: "#e2e8f0",
  fontWeight: 700,
  cursor: "pointer",
};
