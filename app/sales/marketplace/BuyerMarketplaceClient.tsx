"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  API_BASE_URL,
  fetchCompanyWithServices,
  salesBuyerOrders,
  salesCreateOrder,
  salesMarketplaceProducts,
  salesMarketplaceSellers,
  type CompanyServicesDto,
  type MarketplaceProductDto,
} from "@/lib/api";
import BrandLogo from "@/components/BrandLogo";
import MarketplaceProductImageFrame from "@/components/MarketplaceProductImageFrame";
import {
  buildCompanyChips,
  companyFilterFromSelectValue,
  companyFilterToSelectValue,
  countQuickFilter,
  isDemoProductId,
  marketplaceDemoProducts,
  matchesCategory,
  matchesCompanyFilter,
  matchesPriceRange,
  matchesQuickFilter,
  matchesSearch,
  normalizeBuyerProduct,
  sortBuyerRows,
  type BuyerMarketplaceRow,
  type CompanyFilter,
  type MarketplaceCategoryId,
  type MarketplaceSortId,
  type QuickFilterId,
} from "@/lib/marketplaceBuyerView";
import { isLoggedIn, isPortalSession } from "@/lib/auth";

const PLACEHOLDER_BG =
  "linear-gradient(135deg, rgba(30,41,59,0.95), rgba(15,23,42,0.98))";

const FAV_KEY = "marketplace-buyer-favorites-v1";

const CATEGORY_ROW: { id: MarketplaceCategoryId; label: string; icon: string }[] = [
  { id: "all", label: "All", icon: "◎" },
  { id: "flower", label: "Flower", icon: "❀" },
  { id: "popcorn", label: "Popcorn", icon: "◈" },
  { id: "preRolls", label: "Pre-Rolls", icon: "▭" },
  { id: "concentrates", label: "Concentrates", icon: "◆" },
  { id: "liveResin", label: "Live Resin", icon: "✦" },
  { id: "rosin", label: "Rosin", icon: "◇" },
  { id: "vapes", label: "Vapes", icon: "⌁" },
  { id: "edibles", label: "Edibles", icon: "◉" },
  { id: "tinctures", label: "Tinctures", icon: "▽" },
  { id: "topicals", label: "Topicals", icon: "▫" },
  { id: "more", label: "More", icon: "＋" },
];

const SORT_OPTIONS: { id: MarketplaceSortId; label: string }[] = [
  { id: "newest", label: "Newest" },
  { id: "priceAsc", label: "Price: Low to High" },
  { id: "priceDesc", label: "Price: High to Low" },
  { id: "name", label: "Product Name" },
  { id: "company", label: "Company Name" },
  { id: "rating", label: "Highest Rated" },
];

const QUICK_CHIPS: { id: QuickFilterId; label: string; icon: string }[] = [
  { id: "flavors", label: "Flavors", icon: "🍓" },
  { id: "topShelf", label: "Top Shelf", icon: "✶" },
  { id: "indoor", label: "Indoor", icon: "🏠" },
  { id: "organic", label: "Organic", icon: "🌿" },
  { id: "smallBatch", label: "Small Batch", icon: "◇" },
];

type SellerRow = { id: string; name: string; slug: string; productCount: number };

type CartLine = { product: MarketplaceProductDto; quantity: number };

export function BuyerMarketplaceClient() {
  const [services, setServices] = useState<CompanyServicesDto | null>(null);
  const [servicesErr, setServicesErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [sellers, setSellers] = useState<SellerRow[]>([]);
  const [rawProducts, setRawProducts] = useState<MarketplaceProductDto[]>([]);
  const [orders, setOrders] = useState<Record<string, unknown>[]>([]);
  const [companyFilter, setCompanyFilter] = useState<CompanyFilter>({ kind: "all" });
  const [categoryId, setCategoryId] = useState<MarketplaceCategoryId>("all");
  const [sortId, setSortId] = useState<MarketplaceSortId>("newest");
  const [search, setSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilterId | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<BuyerMarketplaceRow | null>(null);
  const [notes, setNotes] = useState("");
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [cartMsg, setCartMsg] = useState("");
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set());
  const companyScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAV_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) setFavorites(new Set(arr.filter((x) => typeof x === "string")));
    } catch {
      /* ignore */
    }
  }, []);

  const persistFavorites = useCallback((next: Set<string>) => {
    setFavorites(next);
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }, []);

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
        setRawProducts([]);
        setOrders([]);
        setLoading(false);
        return;
      }
      const [sel, prod, ord] = await Promise.all([
        salesMarketplaceSellers(),
        salesMarketplaceProducts({}),
        salesBuyerOrders(),
      ]);
      setSellers(sel.sellers || []);
      setRawProducts(prod.products || []);
      setOrders(ord.orders || []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not load marketplace.";
      setErr(msg);
      setServicesErr(msg);
      setServices(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoggedIn()) return;
    void loadCatalog();
  }, [loadCatalog]);

  const companyChips = useMemo(() => buildCompanyChips(sellers), [sellers]);

  const normalizedRows = useMemo(() => {
    const base = rawProducts.length ? rawProducts : marketplaceDemoProducts();
    return base.map(normalizeBuyerProduct);
  }, [rawProducts]);

  const priceBounds = useMemo(() => {
    const minP = minPrice.trim() === "" ? undefined : Number(minPrice);
    const maxP = maxPrice.trim() === "" ? undefined : Number(maxPrice);
    return {
      min: Number.isFinite(minP as number) ? (minP as number) : undefined,
      max: Number.isFinite(maxP as number) ? (maxP as number) : undefined,
    };
  }, [minPrice, maxPrice]);

  const filteredRows = useMemo(() => {
    return normalizedRows.filter(
      (row) =>
        matchesCompanyFilter(row, companyFilter) &&
        matchesSearch(row, search) &&
        matchesCategory(row, categoryId) &&
        matchesQuickFilter(row, quickFilter) &&
        matchesPriceRange(row, priceBounds.min, priceBounds.max),
    );
  }, [normalizedRows, companyFilter, search, categoryId, quickFilter, priceBounds]);

  const sortedRows = useMemo(() => sortBuyerRows(filteredRows, sortId), [filteredRows, sortId]);

  const selectValue = companyFilterToSelectValue(companyFilter);

  const cartCount = useMemo(() => cart.reduce((s, l) => s + l.quantity, 0), [cart]);
  const cartSellerId = useMemo(() => {
    if (!cart.length) return "";
    return cart[0].product.companyId || cart[0].product.company?.id || "";
  }, [cart]);

  const cartTotal = useMemo(
    () => cart.reduce((s, l) => s + l.product.price * l.quantity, 0),
    [cart],
  );

  function toggleFavorite(id: string, e: ReactMouseEvent) {
    e.stopPropagation();
    const next = new Set(favorites);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    persistFavorites(next);
  }

  function addToCart(p: MarketplaceProductDto) {
    setCartMsg("");
    if (isDemoProductId(p.id)) {
      setCartMsg("This is a sample listing. Connect seller workspaces to place real orders.");
      return;
    }
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
  }

  function setLineQty(productId: string, qty: number) {
    if (qty <= 0) {
      setCart((prev) => prev.filter((l) => l.product.id !== productId));
      return;
    }
    setCart((prev) => prev.map((l) => (l.product.id === productId ? { ...l, quantity: qty } : l)));
  }

  async function submitOrder() {
    if (!cart.length) return;
    if (cart.some((l) => isDemoProductId(l.product.id))) {
      setErr("Remove sample products from your cart before submitting an order.");
      return;
    }
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

  function applyCompanyChip(f: CompanyFilter) {
    setCompanyFilter(f);
    setCartMsg("");
  }

  function resetAllFilters() {
    setCompanyFilter({ kind: "all" });
    setCategoryId("all");
    setQuickFilter(null);
    setSearch("");
    setMinPrice("");
    setMaxPrice("");
    setSortId("newest");
  }

  const profileHref = isPortalSession() ? "/portal" : "/";

  if (!isLoggedIn()) {
    return (
      <main style={{ padding: 32, color: "#e2e8f0" }}>
        <Link href="/login" style={{ color: "#22d3ee" }}>
          Sign in
        </Link>{" "}
        to use the marketplace.
      </main>
    );
  }

  if (loading && !services) {
    return (
      <main style={{ padding: 48, color: "#22d3ee", textAlign: "center" }}>
        Loading marketplace…
      </main>
    );
  }

  if (servicesErr && !services) {
    return (
      <main style={{ padding: 32, maxWidth: 560, margin: "0 auto", color: "#fecaca" }}>
        <h1 style={{ color: "#e2e8f0" }}>Marketplace</h1>
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
        <h1 style={{ fontSize: 28, fontWeight: 900 }}>Marketplace</h1>
        <p style={{ color: "#94a3b8", lineHeight: 1.6 }}>
          Buyer Side is not enabled for this workspace. A NexBatch platform admin can enable it from the portal under
          Workspace services.
        </p>
        <Link href="/" style={{ color: "#a78bfa", fontWeight: 700 }}>
          {services.productionEnabled ? "Back to production" : "Back to home"}
        </Link>
      </main>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #020617 0%, #0f172a 45%, #020617 100%)",
        color: "#f8fafc",
        paddingBottom: 96,
      }}
    >
      {/* Sticky header */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "12px 16px",
          background: "rgba(2, 6, 23, 0.72)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(34, 211, 238, 0.12)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.35)",
        }}
      >
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "#fff" }}>
          <BrandLogo linkToHome={false} height={36} maxWidth={140} />
          <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.02em" }}>NexBatch</span>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            aria-label="Open cart"
            style={iconBtn()}
          >
            <CartIcon />
            {cartCount > 0 ? (
              <span
                style={{
                  position: "absolute",
                  top: -4,
                  right: -4,
                  minWidth: 20,
                  height: 20,
                  borderRadius: 999,
                  background: "linear-gradient(135deg, #a855f7, #7c3aed)",
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 900,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "2px solid #020617",
                }}
              >
                {cartCount > 99 ? "99+" : cartCount}
              </span>
            ) : null}
          </button>
          <Link href={profileHref} style={{ ...iconBtn(), textDecoration: "none" }} aria-label="Profile">
            <UserIcon />
          </Link>
        </div>
      </header>

      {services?.productionEnabled ? (
        <div style={{ padding: "12px 16px 0" }}>
          <Link
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 14px",
              borderRadius: 12,
              border: "1px solid rgba(148, 163, 184, 0.35)",
              background: "rgba(15, 23, 42, 0.85)",
              color: "#cbd5e1",
              fontWeight: 700,
              fontSize: 13,
              textDecoration: "none",
            }}
          >
            ← Back to production
          </Link>
        </div>
      ) : null}

      <main style={{ maxWidth: 1280, margin: "0 auto", padding: "16px 16px 32px" }}>
        <section style={{ marginBottom: 22 }}>
          <h1 style={{ margin: 0, fontSize: "clamp(1.75rem, 5vw, 2.25rem)", fontWeight: 900, letterSpacing: "-0.03em" }}>
            Marketplace
          </h1>
          <p style={{ margin: "10px 0 0", color: "#94a3b8", fontSize: 15, lineHeight: 1.55, maxWidth: 520 }}>
            Wholesale cannabis products from trusted cultivators and producers.
          </p>
        </section>

        {/* Company selector */}
        <section style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontWeight: 800, fontSize: 14, color: "#e2e8f0" }}>Select Company</span>
            <button
              type="button"
              onClick={() => companyScrollRef.current?.scrollTo({ left: companyScrollRef.current.scrollWidth, behavior: "smooth" })}
              style={cyanLinkBtn()}
            >
              View all companies
            </button>
          </div>
          <select
            value={selectValue}
            onChange={(e) => applyCompanyChip(companyFilterFromSelectValue(e.target.value))}
            style={{
              width: "100%",
              marginBottom: 12,
              padding: "12px 14px",
              borderRadius: 14,
              border: "1px solid rgba(148, 163, 184, 0.28)",
              background: "rgba(15, 23, 42, 0.95)",
              color: "#f8fafc",
              fontSize: 14,
              outline: "none",
              boxShadow: "0 0 0 0 rgba(34, 211, 238, 0)",
            }}
          >
            {companyChips.map((c) => (
              <option key={c.key} value={companyFilterToSelectValue(c.filter)}>
                {c.label}
                {typeof c.productCount === "number" ? ` (${c.productCount})` : ""}
              </option>
            ))}
          </select>
          <div
            ref={companyScrollRef}
            style={{
              display: "flex",
              gap: 10,
              overflowX: "auto",
              paddingBottom: 8,
              scrollSnapType: "x mandatory",
              WebkitOverflowScrolling: "touch",
            }}
          >
            {companyChips.map((c) => {
              const active =
                (c.filter.kind === "all" && companyFilter.kind === "all") ||
                (c.filter.kind === "seller" &&
                  companyFilter.kind === "seller" &&
                  companyFilter.id === c.filter.id) ||
                (c.filter.kind === "name" &&
                  companyFilter.kind === "name" &&
                  companyFilter.name === c.filter.name);
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => applyCompanyChip(c.filter)}
                  style={{
                    flex: "0 0 auto",
                    scrollSnapAlign: "start",
                    minWidth: 132,
                    padding: "12px 14px",
                    borderRadius: 16,
                    border: active
                      ? "1px solid rgba(34, 211, 238, 0.65)"
                      : "1px solid rgba(148, 163, 184, 0.22)",
                    background: active ? "rgba(8, 47, 73, 0.55)" : "rgba(15, 23, 42, 0.9)",
                    color: "#e2e8f0",
                    cursor: "pointer",
                    textAlign: "left",
                    boxShadow: active ? "0 0 20px rgba(34, 211, 238, 0.18)" : "none",
                  }}
                >
                  <div style={{ fontSize: 20, marginBottom: 6 }}>{c.icon}</div>
                  <div style={{ fontWeight: 800, fontSize: 13, lineHeight: 1.25 }}>{c.label}</div>
                  {typeof c.productCount === "number" ? (
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{c.productCount} products</div>
                  ) : c.filter.kind === "name" ? (
                    <div style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>Filter by name</div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>

        {/* Search / sort / filters */}
        <section style={{ marginBottom: 16 }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              alignItems: "stretch",
            }}
          >
            <div style={{ flex: "1 1 220px", position: "relative" }}>
              <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", opacity: 0.45 }}>
                <SearchIcon />
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products, strains, brands, or tags..."
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "12px 12px 12px 40px",
                  borderRadius: 14,
                  border: "1px solid rgba(148, 163, 184, 0.28)",
                  background: "rgba(2, 6, 23, 0.85)",
                  color: "#fff",
                  fontSize: 14,
                  outline: "none",
                }}
              />
            </div>
            <button type="button" onClick={() => setFilterOpen(true)} style={pillBtn()}>
              <FunnelIcon /> Filters
            </button>
            <select
              value={sortId}
              onChange={(e) => setSortId(e.target.value as MarketplaceSortId)}
              style={{
                padding: "12px 14px",
                borderRadius: 14,
                border: "1px solid rgba(148, 163, 184, 0.28)",
                background: "rgba(15, 23, 42, 0.95)",
                color: "#f8fafc",
                fontSize: 14,
                minWidth: 140,
              }}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* Categories */}
        <section style={{ marginBottom: 18 }}>
          <div
            style={{
              display: "flex",
              gap: 8,
              overflowX: "auto",
              paddingBottom: 6,
              scrollSnapType: "x mandatory",
              WebkitOverflowScrolling: "touch",
            }}
          >
            {CATEGORY_ROW.map((cat) => {
              const active = categoryId === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategoryId(cat.id)}
                  style={{
                    flex: "0 0 auto",
                    scrollSnapAlign: "start",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 6,
                    minWidth: 76,
                    padding: "10px 8px",
                    borderRadius: 16,
                    border: active
                      ? "1px solid rgba(34, 211, 238, 0.55)"
                      : "1px solid rgba(51, 65, 85, 0.6)",
                    background: active ? "rgba(8, 51, 68, 0.5)" : "rgba(15, 23, 42, 0.85)",
                    color: "#f8fafc",
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 700,
                    boxShadow: active ? "0 0 16px rgba(34, 211, 238, 0.15)" : "none",
                  }}
                >
                  <span style={{ fontSize: 18 }}>{cat.icon}</span>
                  {cat.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Trust banner */}
        <section
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "stretch",
            justifyContent: "space-between",
            gap: 12,
            padding: "14px 12px",
            marginBottom: 22,
            borderRadius: 16,
            border: "1px solid rgba(34, 211, 238, 0.15)",
            background: "linear-gradient(90deg, rgba(15,23,42,0.95), rgba(8,47,73,0.35), rgba(15,23,42,0.95))",
          }}
        >
          <div style={{ flex: "1 1 90px", minWidth: 0, borderRight: "1px solid rgba(148,163,184,0.15)", paddingRight: 8 }}>
            <TrustCell icon={<BeakerIcon />} title="Lab Tested" subtitle="COA available" />
          </div>
          <div style={{ flex: "1 1 90px", minWidth: 0, borderRight: "1px solid rgba(148,163,184,0.15)", paddingRight: 8 }}>
            <TrustCell icon={<ShieldIcon />} title="Verified Producers" subtitle="Vetted & trusted" />
          </div>
          <div style={{ flex: "1 1 90px", minWidth: 0 }}>
            <TrustCell icon={<LockIcon />} title="Secure Orders" subtitle="Safe & reliable" />
          </div>
        </section>

        {err ? (
          <div
            style={{
              marginBottom: 14,
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
              marginBottom: 14,
              padding: 12,
              borderRadius: 12,
              background: "rgba(22, 101, 52, 0.35)",
              border: "1px solid rgba(74, 222, 128, 0.45)",
              color: "#bbf7d0",
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            {cartMsg}
          </div>
        ) : null}

        {/* Featured products */}
        <section id="marketplace-products" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Featured Products</h2>
            <button type="button" onClick={resetAllFilters} style={cyanLinkBtn()}>
              View all
            </button>
          </div>
          {loading ? (
            <p style={{ color: "#22d3ee" }}>Loading catalog…</p>
          ) : sortedRows.length === 0 ? (
            <div
              style={{
                padding: 36,
                textAlign: "center",
                borderRadius: 16,
                border: "1px dashed rgba(148,163,184,0.3)",
                color: "#94a3b8",
              }}
            >
              No products match your filters. Try adjusting search or category.
            </div>
          ) : (
            <div className="marketplace-product-grid">
              {sortedRows.map((row) => (
                <ProductCard
                  key={row.raw.id}
                  row={row}
                  favorite={favorites.has(row.raw.id)}
                  onToggleFavorite={toggleFavorite}
                  onOpen={() => setDetailRow(row)}
                  onAdd={() => {
                    addToCart(row.raw);
                    setCartOpen(true);
                  }}
                />
              ))}
            </div>
          )}
        </section>

        {/* Quick filter chips */}
        <section style={{ marginBottom: 28 }}>
          <div
            style={{
              display: "flex",
              gap: 8,
              overflowX: "auto",
              paddingBottom: 6,
              alignItems: "center",
            }}
          >
            {QUICK_CHIPS.map((q) => {
              const n = countQuickFilter(normalizedRows, q.id);
              const on = quickFilter === q.id;
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setQuickFilter(on ? null : q.id)}
                  style={{
                    flex: "0 0 auto",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    borderRadius: 999,
                    border: on ? "1px solid rgba(34, 211, 238, 0.5)" : "1px solid rgba(51, 65, 85, 0.7)",
                    background: on ? "rgba(8, 47, 73, 0.55)" : "rgba(15, 23, 42, 0.9)",
                    color: "#e2e8f0",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  <span>{q.icon}</span>
                  {q.label}
                  <span style={{ color: "#64748b", fontWeight: 800 }}>({n})</span>
                </button>
              );
            })}
            <button type="button" onClick={() => setQuickFilter(null)} style={{ ...cyanLinkBtn(), flex: "0 0 auto" }}>
              View all &gt;
            </button>
          </div>
        </section>

        {/* Orders */}
        <section id="orders" style={{ marginBottom: 100 }}>
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
                    borderRadius: 14,
                    border: "1px solid rgba(148,163,184,0.2)",
                    background: "rgba(15, 23, 42, 0.85)",
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
      </main>

      {/* Bottom nav */}
      <nav
        style={{
          position: "fixed",
          left: 12,
          right: 12,
          bottom: 12,
          zIndex: 40,
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 4,
          padding: "10px 8px",
          borderRadius: 20,
          background: "rgba(2, 6, 23, 0.88)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          border: "1px solid rgba(148, 163, 184, 0.18)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
        }}
      >
        <BottomNavItem href="/" label="Dashboard" icon={<GridIcon />} active={false} />
        <BottomNavItem href="/sales/marketplace" label="Marketplace" icon={<ShopIcon />} active />
        <BottomNavItem href="/orders" label="Orders" icon={<ReceiptIcon />} active={false} />
        <BottomNavItem href="/" label="Messages" icon={<ChatIcon />} active={false} />
        <BottomNavItem href={profileHref} label="Profile" icon={<UserNavIcon />} active={false} />
      </nav>

      {/* Filters drawer */}
      {filterOpen ? (
        <div
          role="presentation"
          style={overlayStyle()}
          onMouseDown={() => setFilterOpen(false)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 400,
              marginTop: "auto",
              borderRadius: "20px 20px 0 0",
              background: "rgba(15, 23, 42, 0.96)",
              border: "1px solid rgba(34, 211, 238, 0.2)",
              padding: 20,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Filters</h3>
            <label style={lbl()}>
              Min price
              <input
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                type="number"
                placeholder="0"
                style={inp()}
              />
            </label>
            <label style={lbl()}>
              Max price
              <input
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                type="number"
                placeholder="Any"
                style={inp()}
              />
            </label>
            <button type="button" onClick={() => setFilterOpen(false)} style={{ ...primaryBtn(), width: "100%", marginTop: 12 }}>
              Apply
            </button>
            <button
              type="button"
              onClick={() => {
                setMinPrice("");
                setMaxPrice("");
              }}
              style={{ ...ghostBtn(), width: "100%", marginTop: 8 }}
            >
              Clear prices
            </button>
          </div>
        </div>
      ) : null}

      {/* Product detail */}
      {detailRow ? (
        <div role="presentation" style={overlayStyle()} onMouseDown={() => setDetailRow(null)}>
          <div
            style={{
              width: "100%",
              maxWidth: 480,
              maxHeight: "90vh",
              overflowY: "auto",
              borderRadius: 20,
              background: "rgba(15, 23, 42, 0.94)",
              backdropFilter: "blur(16px)",
              border: "1px solid rgba(34, 211, 238, 0.22)",
              padding: 0,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ padding: 0 }}>
              <MarketplaceProductImageFrame
                apiBaseUrl={API_BASE_URL}
                imageUrl={detailRow.raw.imageUrl}
                companyInventoryLogoUrl={detailRow.raw.companyInventoryLogoUrl}
                imageDisplayMode={detailRow.raw.imageDisplayMode}
                height={200}
                placeholderBackground={PLACEHOLDER_BG}
                borderRadius={20}
              />
            </div>
            <div style={{ padding: "16px 18px 22px" }}>
              <div style={{ fontSize: 12, color: "#22d3ee", fontWeight: 800 }}>{detailRow.displayCategoryBadge}</div>
              <h3 style={{ margin: "6px 0 4px", fontSize: 22, fontWeight: 900 }}>{detailRow.productName}</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#94a3b8", fontSize: 14 }}>
                {detailRow.sellerCompanyName}
                <VerifiedIcon />
              </div>
              <p style={{ color: "#cbd5e1", fontSize: 14, lineHeight: 1.55, margin: "12px 0" }}>
                {detailRow.raw.description || "Premium wholesale product."}
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                {detailRow.tags.slice(0, 8).map((t) => (
                  <span
                    key={t}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 999,
                      background: "rgba(51, 65, 85, 0.5)",
                      fontSize: 12,
                      color: "#e2e8f0",
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 6 }}>
                Price:{" "}
                <strong style={{ color: "#fff" }}>
                  ${detailRow.raw.price.toFixed(2)} / {detailRow.priceUnit}
                </strong>
              </div>
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 6 }}>
                Available:{" "}
                <strong style={{ color: "#fff" }}>{detailRow.raw.quantityAvailable}</strong>
              </div>
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 6 }}>
                Min. order:{" "}
                <strong style={{ color: "#fff" }}>
                  {detailRow.minOrderQty} {detailRow.minOrderUnit}
                </strong>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, fontSize: 13, color: "#5eead4" }}>
                <BeakerIcon /> Lab tested · COA available
              </div>
              <button
                type="button"
                onClick={() => {
                  addToCart(detailRow.raw);
                  setCartOpen(true);
                }}
                style={{ ...primaryBtn(), width: "100%" }}
              >
                Add to Cart
              </button>
              <button type="button" onClick={() => setDetailRow(null)} style={{ ...ghostBtn(), width: "100%", marginTop: 10 }}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Cart drawer */}
      {cartOpen ? (
        <div
          role="presentation"
          style={{ ...overlayStyle(), justifyContent: "flex-end" }}
          onMouseDown={() => !checkoutBusy && setCartOpen(false)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              height: "100%",
              background: "rgba(15, 23, 42, 0.98)",
              borderLeft: "1px solid rgba(34, 211, 238, 0.15)",
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
                      style={{
                        width: 56,
                        padding: 6,
                        borderRadius: 8,
                        border: "1px solid #334155",
                        background: "#020617",
                        color: "#fff",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setLineQty(l.product.id, 0)}
                      style={{ ...ghostBtn(), padding: "6px 10px" }}
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
                    ...primaryBtn(),
                    width: "100%",
                    marginTop: 14,
                    opacity: checkoutBusy ? 0.7 : 1,
                    cursor: checkoutBusy ? "wait" : "pointer",
                  }}
                >
                  {checkoutBusy ? "Submitting…" : "Submit order"}
                </button>
              </>
            )}
            <button type="button" style={{ ...ghostBtn(), marginTop: 16, width: "100%" }} onClick={() => setCartOpen(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}

    </div>
  );
}

function ProductCard({
  row,
  favorite,
  onToggleFavorite,
  onOpen,
  onAdd,
}: {
  row: BuyerMarketplaceRow;
  favorite: boolean;
  onToggleFavorite: (id: string, e: ReactMouseEvent) => void;
  onOpen: () => void;
  onAdd: () => void;
}) {
  const strainStyle = strainBadgeStyle(row.strainType);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{
        borderRadius: 18,
        border: "1px solid rgba(148, 163, 184, 0.2)",
        background: "linear-gradient(165deg, rgba(15,23,42,0.98), rgba(2,6,23,0.92))",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        cursor: "pointer",
        boxShadow: "0 8px 28px rgba(0,0,0,0.25)",
      }}
    >
      <div style={{ position: "relative" }}>
        <MarketplaceProductImageFrame
          apiBaseUrl={API_BASE_URL}
          imageUrl={row.raw.imageUrl}
          companyInventoryLogoUrl={row.raw.companyInventoryLogoUrl}
          imageDisplayMode={row.raw.imageDisplayMode ?? "COVER"}
          height={140}
          placeholderBackground={PLACEHOLDER_BG}
        />
        <span
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            padding: "4px 8px",
            borderRadius: 8,
            fontSize: 10,
            fontWeight: 800,
            background: "rgba(2, 6, 23, 0.75)",
            border: "1px solid rgba(34, 211, 238, 0.35)",
            color: "#e0f2fe",
          }}
        >
          {row.displayCategoryBadge}
        </span>
        <button
          type="button"
          aria-label={favorite ? "Remove favorite" : "Add favorite"}
          onClick={(e) => onToggleFavorite(row.raw.id, e)}
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 36,
            height: 36,
            borderRadius: 999,
            border: "1px solid rgba(148,163,184,0.25)",
            background: "rgba(2,6,23,0.55)",
            color: favorite ? "#f472b6" : "#94a3b8",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
          }}
        >
          {favorite ? "♥" : "♡"}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAdd();
          }}
          aria-label="Add to cart"
          style={{
            position: "absolute",
            bottom: 8,
            right: 8,
            width: 44,
            height: 44,
            borderRadius: 999,
            border: "none",
            background: "linear-gradient(135deg, #22d3ee, #06b6d4)",
            color: "#020617",
            fontSize: 22,
            fontWeight: 900,
            cursor: "pointer",
            boxShadow: "0 4px 16px rgba(34, 211, 238, 0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          +
        </button>
      </div>
      <div style={{ padding: "12px 12px 14px", flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontWeight: 900, fontSize: 15, lineHeight: 1.25 }}>{row.productName}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#94a3b8" }}>
          {row.sellerCompanyName}
          <VerifiedIcon />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748b" }}>
          <span style={{ color: "#fbbf24" }}>★</span>
          {row.rating.toFixed(1)}
          <span>({row.reviewCount})</span>
          {row.state ? <span style={{ marginLeft: 4, color: "#64748b" }}>{row.state}</span> : null}
        </div>
        {row.strainType ? (
          <span
            style={{
              alignSelf: "flex-start",
              padding: "3px 8px",
              borderRadius: 8,
              fontSize: 10,
              fontWeight: 800,
              ...strainStyle,
            }}
          >
            {row.strainType}
          </span>
        ) : null}
        {row.thcBadge ? (
          <span
            style={{
              alignSelf: "flex-start",
              padding: "3px 8px",
              borderRadius: 8,
              fontSize: 10,
              fontWeight: 800,
              background: "rgba(251, 191, 36, 0.15)",
              color: "#fcd34d",
              border: "1px solid rgba(251, 191, 36, 0.35)",
            }}
          >
            {row.thcBadge}
          </span>
        ) : null}
        <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
          Min. Order: {row.minOrderQty} {row.minOrderUnit}
        </div>
        <div style={{ fontWeight: 900, fontSize: 16, color: "#e0e7ff", marginTop: "auto", paddingTop: 4 }}>
          ${row.raw.price.toFixed(2)}
          <span style={{ fontWeight: 600, fontSize: 12, color: "#94a3b8" }}> / {row.priceUnit}</span>
        </div>
      </div>
    </div>
  );
}

function strainBadgeStyle(t: string): CSSProperties {
  if (t === "Indica") return { background: "rgba(167, 139, 250, 0.2)", color: "#ddd6fe", border: "1px solid rgba(167,139,250,0.35)" };
  if (t === "Sativa") return { background: "rgba(52, 211, 153, 0.18)", color: "#a7f3d0", border: "1px solid rgba(52,211,153,0.35)" };
  return { background: "rgba(34, 211, 238, 0.15)", color: "#a5f3fc", border: "1px solid rgba(34,211,238,0.35)" };
}

function TrustCell({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div style={{ textAlign: "center", padding: "0 4px" }}>
      <div style={{ color: "#22d3ee", display: "flex", justifyContent: "center", marginBottom: 6 }}>{icon}</div>
      <div style={{ fontWeight: 800, fontSize: 12, color: "#f8fafc" }}>{title}</div>
      <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{subtitle}</div>
    </div>
  );
}

function BottomNavItem({
  href,
  label,
  icon,
  active,
  badge,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      style={{
        textDecoration: "none",
        textAlign: "center",
        fontSize: 10,
        fontWeight: 800,
        color: active ? "#c4b5fd" : "#64748b",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        padding: "4px 2px",
        borderRadius: 12,
        background: active ? "rgba(124, 58, 237, 0.12)" : "transparent",
      }}
    >
      <span style={{ position: "relative", color: active ? "#a78bfa" : "#64748b" }}>
        {icon}
        {typeof badge === "number" && badge > 0 ? (
          <span
            style={{
              position: "absolute",
              top: -6,
              right: -8,
              minWidth: 16,
              height: 16,
              borderRadius: 999,
              background: "#7c3aed",
              color: "#fff",
              fontSize: 9,
              fontWeight: 900,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {badge > 9 ? "9+" : badge}
          </span>
        ) : null}
      </span>
      {label}
    </Link>
  );
}

function iconBtn(): CSSProperties {
  return {
    position: "relative",
    width: 44,
    height: 44,
    borderRadius: 12,
    border: "1px solid rgba(148, 163, 184, 0.25)",
    background: "rgba(15, 23, 42, 0.6)",
    color: "#e2e8f0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  };
}

function cyanLinkBtn(): CSSProperties {
  return {
    border: "none",
    background: "none",
    color: "#22d3ee",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
    padding: "4px 0",
  };
}

function pillBtn(): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 16px",
    borderRadius: 14,
    border: "1px solid rgba(148, 163, 184, 0.28)",
    background: "rgba(15, 23, 42, 0.9)",
    color: "#e2e8f0",
    fontWeight: 700,
    fontSize: 14,
    cursor: "pointer",
  };
}

function primaryBtn(): CSSProperties {
  return {
    padding: "14px 16px",
    borderRadius: 14,
    border: "none",
    background: "linear-gradient(135deg, rgba(34, 211, 238, 0.35), rgba(124, 58, 237, 0.45))",
    color: "#fff",
    fontWeight: 900,
    cursor: "pointer",
    boxShadow: "0 4px 20px rgba(34, 211, 238, 0.2)",
  };
}

function ghostBtn(): CSSProperties {
  return {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(148, 163, 184, 0.35)",
    background: "rgba(2, 6, 23, 0.5)",
    color: "#e2e8f0",
    fontWeight: 700,
    cursor: "pointer",
  };
}

function overlayStyle(): CSSProperties {
  return {
    position: "fixed",
    inset: 0,
    zIndex: 2000,
    background: "rgba(0,0,0,0.72)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  };
}

function lbl(): CSSProperties {
  return { display: "block", marginBottom: 12, fontSize: 13, color: "#94a3b8" };
}

function inp(): CSSProperties {
  return {
    display: "block",
    width: "100%",
    marginTop: 6,
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(51, 65, 85, 0.8)",
    background: "#020617",
    color: "#fff",
    boxSizing: "border-box",
  };
}

function CartIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 6h15l-1.5 9h-12z" />
      <circle cx="9" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
      <path d="M6 6 5 3H2" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c2-4 6-6 8-6s6 2 8 6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3-3" />
    </svg>
  );
}

function FunnelIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 5h16l-6 7v5l-4 2v-7z" />
    </svg>
  );
}

function BeakerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 3h6M10 3v7L4 20h16l-6-10V3" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3 4 7v6c0 5 4 8 8 10 4-2 8-5 8-10V7l-8-4z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function VerifiedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="#38bdf8" aria-hidden>
      <path d="M12 2 4 5v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V5l-8-3zM10.5 15.5 7 12l1.4-1.4 2.1 2.1 5.6-5.6L18 8.5l-7.5 7.5z" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z" opacity="0.9" />
    </svg>
  );
}

function ShopIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z" />
      <path d="M3 9 5 4h14l2 5" />
    </svg>
  );
}

function ReceiptIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M7 3h10v18l-2-1-2 1-2-1-2 1-2-1-2 1V3z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a8 8 0 0 1-8 8H8l-5 3v-3H5a8 8 0 1 1 16 0z" />
    </svg>
  );
}

function UserNavIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c2-4 6-6 8-6s6 2 8 6" />
    </svg>
  );
}
