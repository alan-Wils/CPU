"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import BrandLogo from "@/components/BrandLogo";
import MarketplaceOrderInvoiceModal from "@/components/MarketplaceOrderInvoiceModal";
import MarketplaceBuyerBottomNav from "@/components/MarketplaceBuyerBottomNav";
import { fetchCompanyWithServices, salesBuyerOrders, type CompanyServicesDto } from "@/lib/api";
import { isLoggedIn, isPortalSession } from "@/lib/auth";

type OrderItemRow = {
  id: string;
  productNameSnapshot: string;
  quantity: number;
  lineTotal: number;
  skuSnapshot?: string | null;
  priceSnapshot?: number;
};

type BuyerOrderRow = {
  id: string;
  status: string;
  total: number;
  subtotal?: number;
  notes?: string | null;
  createdAt: string;
  sellerCompany?: { id?: string; name?: string; slug?: string };
  items?: OrderItemRow[];
};

function parseOrders(raw: unknown): BuyerOrderRow[] {
  if (!Array.isArray(raw)) return [];
  return raw as BuyerOrderRow[];
}

export default function NexBatchBuyerOrdersPage() {
  const [services, setServices] = useState<CompanyServicesDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [orders, setOrders] = useState<BuyerOrderRow[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [invoiceOrderId, setInvoiceOrderId] = useState<string | null>(null);

  const profileHref = isPortalSession() ? "/portal" : "/";

  const load = useCallback(async () => {
    setErr("");
    setLoading(true);
    try {
      const svcOut = await fetchCompanyWithServices();
      const s = (svcOut.services as CompanyServicesDto) || null;
      setServices(s);
      if (!s?.salesBuyerEnabled) {
        setOrders([]);
        setLoading(false);
        return;
      }
      const out = await salesBuyerOrders();
      setOrders(parseOrders(out.orders));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not load orders.");
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoggedIn()) return;
    void load();
  }, [load]);

  if (!isLoggedIn()) {
    return (
      <main style={{ padding: 32, color: "#e2e8f0", minHeight: "100vh", background: "#020617" }}>
        <Link href="/login" style={{ color: "#22d3ee" }}>
          Sign in
        </Link>{" "}
        to view NexBatch wholesale orders.
      </main>
    );
  }

  if (loading) {
    return (
      <main style={{ padding: 48, color: "#22d3ee", textAlign: "center", minHeight: "100vh", background: "#020617" }}>
        Loading orders…
      </main>
    );
  }

  if (services && !services.salesBuyerEnabled) {
    return (
      <main style={{ padding: 32, color: "#e2e8f0", minHeight: "100vh", background: "#020617" }}>
        <p style={{ color: "#94a3b8" }}>Buyer marketplace is not enabled for this workspace.</p>
        <Link href="/" style={{ color: "#22d3ee" }}>
          Home
        </Link>
      </main>
    );
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at top, #1e293b 0, #020617 45%, #000 100%)",
        color: "#e2e8f0",
        padding: "16px 16px 100px",
        boxSizing: "border-box",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <BrandLogo linkToHome={false} height={36} maxWidth={140} />
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>NexBatch orders</h1>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#64748b" }}>
              Wholesale marketplace orders you placed as this company.
            </p>
          </div>
        </div>
        <Link
          href="/sales/marketplace"
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid rgba(34, 211, 238, 0.45)",
            color: "#7dd3fc",
            fontWeight: 800,
            fontSize: 13,
            textDecoration: "none",
          }}
        >
          ← Marketplace
        </Link>
      </header>

      <p style={{ fontSize: 13, color: "#64748b", marginBottom: 18, lineHeight: 1.5 }}>
        LeafLink B2B orders live on{" "}
        <Link href="/orders" style={{ color: "#22d3ee", fontWeight: 700 }}>
          Orders
        </Link>{" "}
        (company workspace). This page is only for NexBatch seller-to-buyer marketplace checkout.
      </p>

      {err ? (
        <div
          style={{
            marginBottom: 16,
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
      ) : null}

      {orders.length === 0 ? (
        <div
          style={{
            padding: 36,
            textAlign: "center",
            borderRadius: 16,
            border: "1px dashed rgba(148,163,184,0.3)",
            color: "#94a3b8",
          }}
        >
          No NexBatch marketplace orders yet. Place one from the{" "}
          <Link href="/sales/marketplace" style={{ color: "#22d3ee", fontWeight: 700 }}>
            marketplace
          </Link>
          .
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {orders.map((o) => {
            const open = expandedId === o.id;
            const sellerName = o.sellerCompany?.name || "Seller";
            const items = Array.isArray(o.items) ? o.items : [];
            return (
              <div
                key={o.id}
                style={{
                  borderRadius: 16,
                  border: "1px solid rgba(148,163,184,0.22)",
                  background: "rgba(15, 23, 42, 0.88)",
                  overflow: "hidden",
                }}
              >
                <div style={{ display: "flex", alignItems: "stretch", gap: 0, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(open ? null : o.id)}
                    style={{
                      flex: "1 1 220px",
                      textAlign: "left",
                      padding: 16,
                      border: "none",
                      background: "transparent",
                      color: "inherit",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                      <div>
                        <div style={{ fontWeight: 900, fontSize: 16 }}>{sellerName}</div>
                        <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
                          {String(o.status)} · {new Date(o.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <div style={{ fontWeight: 900, fontSize: 18, color: "#a5b4fc" }}>
                        ${Number(o.total).toFixed(2)}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>
                      {open ? "Hide line items ▲" : `Line items (${items.length}) ▼`}
                    </div>
                  </button>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "12px 16px",
                      borderLeft: "1px solid rgba(51,65,85,0.55)",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setInvoiceOrderId(o.id)}
                      style={{
                        padding: "10px 14px",
                        borderRadius: 12,
                        border: "1px solid rgba(34,211,238,0.45)",
                        background: "rgba(8,47,73,0.55)",
                        color: "#e0f2fe",
                        fontWeight: 800,
                        fontSize: 13,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Invoice
                    </button>
                  </div>
                </div>
                {open ? (
                  <div
                    style={{
                      borderTop: "1px solid rgba(51,65,85,0.6)",
                      padding: "12px 16px 16px",
                      background: "rgba(2,6,23,0.45)",
                    }}
                  >
                    {o.notes ? (
                      <p style={{ margin: "0 0 12px", fontSize: 13, color: "#94a3b8" }}>
                        <strong style={{ color: "#cbd5e1" }}>Notes:</strong> {o.notes}
                      </p>
                    ) : null}
                    {items.length === 0 ? (
                      <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>No line items returned.</p>
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: 18, color: "#cbd5e1", fontSize: 14, lineHeight: 1.6 }}>
                        {items.map((it) => (
                          <li key={it.id}>
                            {it.productNameSnapshot}
                            {it.skuSnapshot ? ` · SKU ${it.skuSnapshot}` : ""} — qty {it.quantity} · $
                            {Number(it.lineTotal).toFixed(2)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <MarketplaceBuyerBottomNav active="nexbatch_orders" profileHref={profileHref} />

      <MarketplaceOrderInvoiceModal
        open={invoiceOrderId !== null}
        onClose={() => setInvoiceOrderId(null)}
        orderId={invoiceOrderId}
        role="buyer"
      />
    </main>
  );
}
