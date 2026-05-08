"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  fetchCompanyWithServices,
  salesBuyerOrders,
  salesCreateOrder,
  salesMarketplaceProducts,
  salesMarketplaceSellers,
  type CompanyServicesDto,
  type MarketplaceProductDto,
} from "@/lib/api";
import { isLoggedIn } from "@/lib/auth";

type CartLine = {
  product: MarketplaceProductDto;
  quantity: number;
};

type SellerRow = { id: string; name: string; slug: string; productCount: number };

export default function MarketplacePage() {
  const [services, setServices] = useState<CompanyServicesDto | null>(null);
  const [servicesErr, setServicesErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [sellers, setSellers] = useState<SellerRow[]>([]);
  const [products, setProducts] = useState<MarketplaceProductDto[]>([]);
  const [orders, setOrders] = useState<Record<string, unknown>[]>([]);
  const [search, setSearch] = useState("");
  const [filterCompanyId, setFilterCompanyId] = useState("");
  const [category, setCategory] = useState("");
  const [productType, setProductType] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [cartMsg, setCartMsg] = useState("");

  const loadCatalog = useCallback(async () => {
    setErr("");
    setLoading(true);
    setServicesErr("");
    try {
      const svcOut = await fetchCompanyWithServices();
      const s = (svcOut.services as CompanyServicesDto) || null;
      setServices(s);
      if (!s?.salesBuyerEnabled) {
        setSellers([]);
        setProducts([]);
        setOrders([]);
        setLoading(false);
        return;
      }
      const minP = minPrice.trim() === "" ? undefined : Number(minPrice);
      const maxP = maxPrice.trim() === "" ? undefined : Number(maxPrice);
      const [sel, prod, ord] = await Promise.all([
        salesMarketplaceSellers(),
        salesMarketplaceProducts({
          search: search.trim() || undefined,
          companyId: filterCompanyId || undefined,
          category: category.trim() || undefined,
          productType: productType.trim() || undefined,
          minPrice: Number.isFinite(minP as number) ? minP : undefined,
          maxPrice: Number.isFinite(maxP as number) ? maxP : undefined,
        }),
        salesBuyerOrders(),
      ]);
      setSellers(sel.sellers || []);
      setProducts(prod.products || []);
      setOrders(ord.orders || []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not load marketplace.";
      setErr(msg);
      setServicesErr(msg);
      setServices(null);
    } finally {
      setLoading(false);
    }
  }, [search, filterCompanyId, category, productType, minPrice, maxPrice]);

  useEffect(() => {
    if (!isLoggedIn()) return;
    void loadCatalog();
  }, [loadCatalog]);

  const cartSellerId = useMemo(() => {
    if (!cart.length) return "";
    return cart[0].product.companyId || cart[0].product.company?.id || "";
  }, [cart]);

  function addToCart(p: MarketplaceProductDto) {
    setCartMsg("");
    const sid = p.companyId || p.company?.id || "";
    if (cart.length && cartSellerId && sid && cartSellerId !== sid) {
      setCartMsg("Your cart can only include products from one seller. Remove items or create a separate order.");
      return;
    }
    setCart((prev) => {
      const i = prev.findIndex((l) => l.product.id === p.id);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], quantity: next[i].quantity + 1 };
        return next;
      }
      return [...prev, { product: p, quantity: 1 }];
    });
    setCartOpen(true);
  }

  function setLineQty(productId: string, qty: number) {
    if (qty <= 0) {
      setCart((prev) => prev.filter((l) => l.product.id !== productId));
      return;
    }
    setCart((prev) => prev.map((l) => (l.product.id === productId ? { ...l, quantity: qty } : l)));
  }

  const cartTotal = useMemo(
    () => cart.reduce((s, l) => s + l.product.price * l.quantity, 0),
    [cart],
  );

  async function submitOrder() {
    if (!cart.length) return;
    const sellerCompanyId = cartSellerId;
    if (!sellerCompanyId) {
      setErr("Missing seller for this cart.");
      return;
    }
    setCheckoutBusy(true);
    setErr("");
    try {
      await salesCreateOrder({
        sellerCompanyId,
        notes: notes.trim() || null,
        lines: cart.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
      });
      setCart([]);
      setNotes("");
      setCartOpen(false);
      setCartMsg("Order submitted. The seller will see it as pending.");
      await loadCatalog();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Checkout failed.");
    } finally {
      setCheckoutBusy(false);
    }
  }

  if (!isLoggedIn()) {
    return (
      <main style={{ padding: 32, color: "#e2e8f0" }}>
        <Link href="/login" style={{ color: "#93c5fd" }}>
          Sign in
        </Link>{" "}
        to use the marketplace.
      </main>
    );
  }

  if (loading && !services) {
    return (
      <main style={{ padding: 48, color: "#93c5fd", textAlign: "center" }}>
        Loading marketplace…
      </main>
    );
  }

  if (servicesErr && !services) {
    return (
      <main style={{ padding: 32, maxWidth: 560, margin: "0 auto", color: "#fecaca" }}>
        <h1 style={{ color: "#e2e8f0" }}>NexBatch Marketplace</h1>
        <p>{servicesErr}</p>
        <Link href="/" style={{ color: "#a78bfa" }}>
          Back to home
        </Link>
      </main>
    );
  }

  if (services && !services.salesBuyerEnabled) {
    return (
      <main style={{ padding: 32, maxWidth: 640, margin: "0 auto", color: "#e2e8f0" }}>
        <h1 style={{ fontSize: 28, fontWeight: 900 }}>NexBatch Marketplace</h1>
        <p style={{ color: "#94a3b8", lineHeight: 1.6 }}>
          Buyer Side is not enabled for this workspace. A NexBatch platform admin can enable it from the portal under
          Workspace services.
        </p>
        <Link href="/" style={{ color: "#a78bfa", fontWeight: 700 }}>
          Back to home
        </Link>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh", padding: "24px 20px 48px", maxWidth: 1200, margin: "0 auto", color: "#e2e8f0" }}>
      <header style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 16, alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 32, fontWeight: 900, color: "#f8fafc" }}>NexBatch Marketplace</h1>
            <p style={{ margin: "8px 0 0", color: "#94a3b8", maxWidth: 560 }}>
              B2B wholesale catalog from verified seller workspaces. One cart per seller per order.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            style={{
              padding: "12px 20px",
              borderRadius: 14,
              border: "1px solid rgba(34, 197, 94, 0.55)",
              background: "rgba(22, 101, 52, 0.35)",
              color: "#bbf7d0",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Cart ({cart.length})
          </button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            style={inp()}
          />
          <select
            value={filterCompanyId}
            onChange={(e) => setFilterCompanyId(e.target.value)}
            style={inp()}
          >
            <option value="">All sellers</option>
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.productCount})
              </option>
            ))}
          </select>
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" style={inp()} />
          <input
            value={productType}
            onChange={(e) => setProductType(e.target.value)}
            placeholder="Product type"
            style={inp()}
          />
          <input value={minPrice} onChange={(e) => setMinPrice(e.target.value)} placeholder="Min $" style={inp()} />
          <input value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="Max $" style={inp()} />
          <button type="button" onClick={() => void loadCatalog()} style={btnSecondary()}>
            Apply filters
          </button>
        </div>
      </header>

      {err ? (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 12,
            background: "rgba(127, 29, 29, 0.4)",
            border: "1px solid rgba(248, 113, 113, 0.45)",
            color: "#fecaca",
          }}
        >
          {err}
        </div>
      ) : null}
      {cartMsg ? (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 12,
            background: "rgba(22, 101, 52, 0.35)",
            border: "1px solid rgba(74, 222, 128, 0.45)",
            color: "#bbf7d0",
            fontWeight: 700,
          }}
        >
          {cartMsg}
        </div>
      ) : null}

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>Sellers</h2>
        {sellers.length === 0 ? (
          <p style={{ color: "#64748b" }}>No sellers with available listings right now.</p>
        ) : (
          <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 6 }}>
            {sellers.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setFilterCompanyId(s.id)}
                style={{
                  minWidth: 200,
                  textAlign: "left",
                  padding: 14,
                  borderRadius: 14,
                  border: "1px solid rgba(148,163,184,0.3)",
                  background: "#0f172a",
                  color: "#e2e8f0",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 800 }}>{s.name}</div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{s.productCount} products</div>
              </button>
            ))}
          </div>
        )}
      </section>

      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>Products</h2>
        {loading ? (
          <p style={{ color: "#93c5fd" }}>Loading…</p>
        ) : products.length === 0 ? (
          <div
            style={{
              padding: 32,
              borderRadius: 16,
              border: "1px dashed rgba(148,163,184,0.35)",
              color: "#94a3b8",
              textAlign: "center",
            }}
          >
            No products match your filters. Try clearing filters or search.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
            {products.map((p) => (
              <div
                key={p.id}
                style={{
                  borderRadius: 16,
                  border: "1px solid rgba(148,163,184,0.25)",
                  background: "#0f172a",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{
                    height: 130,
                    background: p.imageUrl
                      ? `url(${p.imageUrl}) center/cover`
                      : "linear-gradient(135deg, rgba(30,41,59,0.95), rgba(15,23,42,0.98))",
                  }}
                />
                <div style={{ padding: 14, flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontSize: 12, color: "#a78bfa", fontWeight: 700 }}>
                    {p.company?.name || "Seller"}
                  </div>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{p.name}</div>
                  <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.4, flex: 1 }}>
                    {(p.description || "").slice(0, 120)}
                    {(p.description || "").length > 120 ? "…" : ""}
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>
                    {[p.category, p.productType].filter(Boolean).join(" · ") || "—"}
                    {p.sku ? ` · ${p.sku}` : ""}
                    {p.unitSize ? ` · ${p.unitSize}` : ""}
                  </div>
                  <div style={{ fontWeight: 900, color: "#a5b4fc" }}>
                    ${p.price.toFixed(2)} · {p.quantityAvailable} avail
                  </div>
                  <button
                    type="button"
                    onClick={() => addToCart(p)}
                    style={{
                      marginTop: 8,
                      padding: "10px 14px",
                      borderRadius: 12,
                      border: "1px solid rgba(56, 189, 248, 0.55)",
                      background: "rgba(8, 47, 73, 0.75)",
                      color: "#7dd3fc",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    Add to cart
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>Your orders</h2>
        {orders.length === 0 ? (
          <p style={{ color: "#64748b" }}>No orders yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {orders.map((o) => (
              <div
                key={String(o.id)}
                style={{
                  padding: 14,
                  borderRadius: 12,
                  border: "1px solid rgba(148,163,184,0.2)",
                  background: "#0f172a",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <span style={{ fontWeight: 800 }}>
                    {(o.sellerCompany as { name?: string } | undefined)?.name || "Seller"}
                  </span>
                  <span style={{ color: "#a5b4fc", fontWeight: 800 }}>${Number(o.total).toFixed(2)}</span>
                </div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                  {String(o.status)} · {new Date(String(o.createdAt)).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {cartOpen ? (
        <div
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.72)",
            zIndex: 2000,
            display: "flex",
            justifyContent: "flex-end",
          }}
          onMouseDown={() => !checkoutBusy && setCartOpen(false)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              height: "100%",
              background: "#0f172a",
              borderLeft: "1px solid rgba(148,163,184,0.35)",
              padding: 20,
              boxSizing: "border-box",
              overflowY: "auto",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Cart</h3>
            {cartMsg ? <p style={{ color: "#fde68a", fontSize: 13 }}>{cartMsg}</p> : null}
            {cart.length === 0 ? (
              <p style={{ color: "#64748b" }}>Cart is empty.</p>
            ) : (
              <>
                <p style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12 }}>
                  Seller: {cart[0].product.company?.name || "—"}
                </p>
                {cart.map((l) => (
                  <div
                    key={l.product.id}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      marginBottom: 12,
                      paddingBottom: 12,
                      borderBottom: "1px solid rgba(148,163,184,0.15)",
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700 }}>{l.product.name}</div>
                      <div style={{ fontSize: 12, color: "#64748b" }}>${l.product.price.toFixed(2)} ea</div>
                    </div>
                    <input
                      type="number"
                      min={1}
                      value={l.quantity}
                      onChange={(e) => setLineQty(l.product.id, Number(e.target.value))}
                      style={{ width: 56, padding: 6, borderRadius: 8, border: "1px solid #334155", background: "#020617", color: "#fff" }}
                    />
                    <button
                      type="button"
                      onClick={() => setLineQty(l.product.id, 0)}
                      style={{ ...btnSecondary(), padding: "6px 10px" }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <label style={{ display: "block", marginTop: 12, fontSize: 13 }}>
                  <span style={{ color: "#94a3b8" }}>Order notes</span>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    style={{
                      display: "block",
                      width: "100%",
                      marginTop: 6,
                      padding: 8,
                      borderRadius: 8,
                      border: "1px solid #334155",
                      background: "#020617",
                      color: "#fff",
                      resize: "vertical",
                    }}
                  />
                </label>
                <div style={{ marginTop: 16, fontWeight: 900, fontSize: 18 }}>Total ${cartTotal.toFixed(2)}</div>
                <button
                  type="button"
                  disabled={checkoutBusy}
                  onClick={() => void submitOrder()}
                  style={{
                    marginTop: 14,
                    width: "100%",
                    padding: "14px 16px",
                    borderRadius: 12,
                    border: "none",
                    background: "linear-gradient(135deg, rgba(34,197,94,0.5), rgba(22,101,52,0.9))",
                    color: "#fff",
                    fontWeight: 900,
                    cursor: checkoutBusy ? "wait" : "pointer",
                  }}
                >
                  {checkoutBusy ? "Submitting…" : "Submit order"}
                </button>
              </>
            )}
            <button
              type="button"
              style={{ ...btnSecondary(), marginTop: 16, width: "100%" }}
              onClick={() => setCartOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function inp(): CSSProperties {
  return {
    flex: "1 1 140px",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(148,163,184,0.35)",
    background: "#020617",
    color: "#fff",
    minWidth: 0,
  };
}

function btnSecondary(): CSSProperties {
  return {
    padding: "10px 16px",
    borderRadius: 10,
    border: "1px solid rgba(148,163,184,0.45)",
    background: "#1e293b",
    color: "#e2e8f0",
    fontWeight: 700,
    cursor: "pointer",
  };
}
