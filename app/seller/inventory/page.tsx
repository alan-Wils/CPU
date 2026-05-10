"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  API_BASE_URL,
  fetchCompanyWithServices,
  salesLeafLinkSyncInventory,
  salesSellerProductPatch,
  salesSellerProducts,
  type CompanyServicesDto,
  type MarketplaceProductDto,
} from "@/lib/api";
import { isLoggedIn } from "@/lib/auth";
import MarketplaceProductImageFrame from "@/components/MarketplaceProductImageFrame";

type AvailabilityFilter = "ALL" | "AVAILABLE" | "INTERNAL" | "NOT_AVAILABLE";
type SourceFilter = "ALL" | "MANUAL" | "LEAFLINK";

const placeholderImg =
  "linear-gradient(135deg, rgba(30,41,59,0.95), rgba(15,23,42,0.98))";

const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: "Available",
  INTERNAL: "Internal",
  NOT_AVAILABLE: "Not available",
};

function statusPillStyle(status: string): CSSProperties {
  if (status === "AVAILABLE") {
    return {
      background: "rgba(34,197,94,0.18)",
      color: "#86efac",
      border: "1px solid rgba(34,197,94,0.45)",
    };
  }
  if (status === "INTERNAL") {
    return {
      background: "rgba(96,165,250,0.18)",
      color: "#bfdbfe",
      border: "1px solid rgba(96,165,250,0.45)",
    };
  }
  return {
    background: "rgba(148,163,184,0.18)",
    color: "#cbd5e1",
    border: "1px solid rgba(148,163,184,0.4)",
  };
}

function sourcePillStyle(source: string): CSSProperties {
  if (source === "LEAFLINK") {
    return {
      background: "rgba(168,85,247,0.16)",
      color: "#e9d5ff",
      border: "1px solid rgba(168,85,247,0.4)",
    };
  }
  return {
    background: "rgba(34,211,238,0.14)",
    color: "#a5f3fc",
    border: "1px solid rgba(34,211,238,0.4)",
  };
}

const formatUsd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const formatNumber = (n: number) => new Intl.NumberFormat("en-US").format(n);

export default function SellerInventoryPage() {
  const [services, setServices] = useState<CompanyServicesDto | null>(null);
  const [products, setProducts] = useState<MarketplaceProductDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [availability, setAvailability] = useState<AvailabilityFilter>("ALL");
  const [source, setSource] = useState<SourceFilter>("ALL");
  const [category, setCategory] = useState("ALL");
  const [busyRowId, setBusyRowId] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);

  const loadAll = useCallback(async () => {
    if (!isLoggedIn()) {
      setLoading(false);
      return;
    }
    setErr("");
    setLoading(true);
    try {
      const [svc, prodRes] = await Promise.all([
        fetchCompanyWithServices().catch(() => ({ services: null })),
        salesSellerProducts(),
      ]);
      setServices((svc.services as CompanyServicesDto) ?? null);
      setProducts(prodRes.products || []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not load inventory.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      const c = String(p.category || "").trim();
      if (c) set.add(c);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (availability !== "ALL" && String(p.availabilityStatus || "").toUpperCase() !== availability) {
        return false;
      }
      if (source !== "ALL" && String(p.source || "").toUpperCase() !== source) {
        return false;
      }
      if (category !== "ALL" && String(p.category || "").trim() !== category) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        p.name,
        p.sku,
        p.category,
        p.productType,
        p.strainName,
        p.flavorName,
        p.unitSize,
        p.potencyLabel,
        p.strainDominance,
      ]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      return haystack.includes(q);
    });
  }, [products, search, availability, source, category]);

  const totals = useMemo(() => {
    let units = 0;
    let value = 0;
    for (const p of filtered) {
      const qty = Number.isFinite(p.quantityAvailable) ? Number(p.quantityAvailable) : 0;
      const price = Number.isFinite(p.price) ? Number(p.price) : 0;
      units += qty;
      value += qty * price;
    }
    return {
      skus: filtered.length,
      units,
      value,
      categories: new Set(filtered.map((p) => String(p.category || "").trim()).filter(Boolean)).size,
    };
  }, [filtered]);

  async function quickAvailability(
    productId: string,
    next: "AVAILABLE" | "INTERNAL" | "NOT_AVAILABLE",
  ) {
    setBusyRowId(productId);
    try {
      const res = await salesSellerProductPatch(productId, { availabilityStatus: next });
      setProducts((prev) => prev.map((p) => (p.id === productId ? res.product : p)));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not update availability.");
    } finally {
      setBusyRowId("");
    }
  }

  async function runLeafLinkSync() {
    if (!services?.leafLinkInventorySyncEnabled) return;
    setSyncBusy(true);
    setErr("");
    try {
      await salesLeafLinkSyncInventory();
      await loadAll();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "LeafLink sync failed.");
    } finally {
      setSyncBusy(false);
    }
  }

  if (!isLoggedIn()) {
    return (
      <div style={{ color: "#94a3b8", padding: 24 }}>
        Please <Link href="/login" style={{ color: "#a5b4fc" }}>sign in</Link> to view inventory.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: "#f8fafc" }}>Seller Inventory</h1>
          <p style={{ margin: "8px 0 0", color: "#94a3b8", fontSize: 14, lineHeight: 1.55, maxWidth: 720 }}>
            Every product you publish — manual marketplace listings and (when enabled) LeafLink-synced items — shows up
            here with live stock and availability.
          </p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <Link
            href="/sales/seller"
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "10px 16px",
              borderRadius: 12,
              border: "1px solid rgba(167,139,250,0.55)",
              background: "linear-gradient(135deg, rgba(91,33,182,0.45), rgba(30,41,59,0.95))",
              color: "#fff",
              fontWeight: 800,
              textDecoration: "none",
              fontSize: 14,
            }}
          >
            + Add / edit products
          </Link>
          {services?.leafLinkInventorySyncEnabled ? (
            <button
              type="button"
              onClick={() => void runLeafLinkSync()}
              disabled={syncBusy}
              style={{
                padding: "10px 16px",
                borderRadius: 12,
                border: "1px solid rgba(34,211,238,0.45)",
                background: syncBusy ? "rgba(8,47,73,0.5)" : "rgba(8,47,73,0.85)",
                color: "#bae6fd",
                fontWeight: 800,
                cursor: syncBusy ? "wait" : "pointer",
                fontSize: 14,
              }}
            >
              {syncBusy ? "Syncing…" : "Sync LeafLink"}
            </button>
          ) : null}
        </div>
      </header>

      {err ? (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid rgba(248,113,113,0.5)",
            background: "rgba(127,29,29,0.35)",
            color: "#fecaca",
            fontSize: 13,
          }}
        >
          {err}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 14,
        }}
      >
        <StatTile label="Total Products" value={formatNumber(totals.skus)} />
        <StatTile label="Total Units" value={formatNumber(totals.units)} />
        <StatTile label="Inventory Value" value={formatUsd(totals.value)} />
        <StatTile label="Categories" value={formatNumber(totals.categories)} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(260px, 1fr) repeat(3, minmax(160px, auto))",
          gap: 10,
          padding: 14,
          borderRadius: 16,
          border: "1px solid rgba(51,65,85,0.55)",
          background: "rgba(15,23,42,0.7)",
        }}
      >
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, SKU, strain, category…"
          style={inputStyle()}
        />
        <select
          value={availability}
          onChange={(e) => setAvailability(e.target.value as AvailabilityFilter)}
          style={inputStyle()}
        >
          <option value="ALL">All availability</option>
          <option value="AVAILABLE">Available</option>
          <option value="INTERNAL">Internal</option>
          <option value="NOT_AVAILABLE">Not available</option>
        </select>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as SourceFilter)}
          style={inputStyle()}
        >
          <option value="ALL">All sources</option>
          <option value="MANUAL">Manual listings</option>
          <option value="LEAFLINK">LeafLink synced</option>
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={inputStyle()}
        >
          <option value="ALL">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div
        style={{
          borderRadius: 16,
          border: "1px solid rgba(51,65,85,0.55)",
          background: "rgba(15,23,42,0.7)",
          overflow: "hidden",
        }}
      >
        {loading ? (
          <div style={{ padding: 24, color: "#94a3b8", fontSize: 14 }}>Loading inventory…</div>
        ) : products.length === 0 ? (
          <EmptyInventoryState />
        ) : filtered.length === 0 ? (
          <div style={{ padding: 24, color: "#94a3b8", fontSize: 14 }}>
            No products match the current filters.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 880 }}>
              <thead>
                <tr style={{ background: "rgba(2,6,23,0.6)", color: "#94a3b8", fontSize: 11, letterSpacing: "0.06em" }}>
                  <Th>Product</Th>
                  <Th>SKU / Category</Th>
                  <Th align="right">Price</Th>
                  <Th align="right">Qty available</Th>
                  <Th align="right">Line value</Th>
                  <Th>Status</Th>
                  <Th>Source</Th>
                  <Th align="right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const qty = Number.isFinite(p.quantityAvailable) ? Number(p.quantityAvailable) : 0;
                  const price = Number.isFinite(p.price) ? Number(p.price) : 0;
                  const lineValue = qty * price;
                  const lowStock = qty > 0 && qty < 5;
                  const sub = [p.category, p.productType].filter(Boolean).join(" · ");
                  return (
                    <tr
                      key={p.id}
                      style={{
                        borderTop: "1px solid rgba(30,41,59,0.65)",
                        background: lowStock ? "rgba(120,53,15,0.18)" : undefined,
                      }}
                    >
                      <Td>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 220 }}>
                          <div
                            style={{
                              flexShrink: 0,
                              width: 52,
                              height: 52,
                              borderRadius: 10,
                              overflow: "hidden",
                              border: "1px solid rgba(51,65,85,0.55)",
                            }}
                          >
                            <MarketplaceProductImageFrame
                              apiBaseUrl={API_BASE_URL}
                              imageUrl={p.imageUrl}
                              companyInventoryLogoUrl={p.companyInventoryLogoUrl}
                              imageDisplayMode={p.imageDisplayMode}
                              fillParent
                              height={52}
                              placeholderBackground={placeholderImg}
                            />
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 800, color: "#f8fafc", fontSize: 14 }}>{p.name || "Untitled"}</div>
                            {p.unitSize ? (
                              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{p.unitSize}</div>
                            ) : null}
                          </div>
                        </div>
                      </Td>
                      <Td>
                        <div style={{ fontSize: 13, color: "#e2e8f0" }}>{p.sku || "—"}</div>
                        <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{sub || "Uncategorised"}</div>
                      </Td>
                      <Td align="right">
                        <div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 700 }}>{formatUsd(price)}</div>
                      </Td>
                      <Td align="right">
                        <div style={{ fontSize: 13, color: lowStock ? "#fed7aa" : "#e2e8f0", fontWeight: 700 }}>
                          {formatNumber(qty)}
                        </div>
                        {lowStock ? (
                          <div style={{ fontSize: 10, color: "#fcd34d", marginTop: 2 }}>Low stock</div>
                        ) : null}
                      </Td>
                      <Td align="right">
                        <div style={{ fontSize: 13, color: "#e2e8f0" }}>{formatUsd(lineValue)}</div>
                      </Td>
                      <Td>
                        <span
                          style={{
                            display: "inline-flex",
                            padding: "3px 9px",
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 800,
                            ...statusPillStyle(p.availabilityStatus),
                          }}
                        >
                          {STATUS_LABEL[p.availabilityStatus] ?? p.availabilityStatus}
                        </span>
                      </Td>
                      <Td>
                        <span
                          style={{
                            display: "inline-flex",
                            padding: "3px 9px",
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 800,
                            ...sourcePillStyle(p.source),
                          }}
                        >
                          {p.source}
                        </span>
                      </Td>
                      <Td align="right">
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                          <select
                            value={p.availabilityStatus}
                            disabled={busyRowId === p.id}
                            onChange={(e) =>
                              void quickAvailability(
                                p.id,
                                e.target.value as "AVAILABLE" | "INTERNAL" | "NOT_AVAILABLE",
                              )
                            }
                            style={{
                              padding: "6px 8px",
                              borderRadius: 8,
                              border: "1px solid rgba(148,163,184,0.35)",
                              background: "#020617",
                              color: "#e2e8f0",
                              fontSize: 12,
                              cursor: busyRowId === p.id ? "wait" : "pointer",
                            }}
                          >
                            <option value="AVAILABLE">Available</option>
                            <option value="INTERNAL">Internal</option>
                            <option value="NOT_AVAILABLE">Not avail.</option>
                          </select>
                          <Link
                            href="/sales/seller"
                            style={{
                              padding: "6px 10px",
                              borderRadius: 8,
                              border: "1px solid rgba(167,139,250,0.45)",
                              background: "rgba(76,29,149,0.35)",
                              color: "#e9d5ff",
                              fontWeight: 700,
                              fontSize: 12,
                              textDecoration: "none",
                            }}
                          >
                            Edit
                          </Link>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "16px 18px",
        borderRadius: 16,
        border: "1px solid rgba(51,65,85,0.55)",
        background: "linear-gradient(165deg, rgba(15,23,42,0.95), rgba(2,6,23,0.95))",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ marginTop: 6, fontSize: 24, fontWeight: 900, color: "#f8fafc" }}>{value}</div>
    </div>
  );
}

function inputStyle(): CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(148,163,184,0.35)",
    background: "rgba(2,6,23,0.85)",
    color: "#f8fafc",
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
    width: "100%",
  };
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <th
      style={{
        textAlign: align === "right" ? "right" : "left",
        textTransform: "uppercase",
        fontWeight: 800,
        padding: "10px 14px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <td
      style={{
        padding: "12px 14px",
        verticalAlign: "middle",
        textAlign: align === "right" ? "right" : "left",
      }}
    >
      {children}
    </td>
  );
}

function EmptyInventoryState() {
  return (
    <div
      style={{
        padding: "36px 24px",
        textAlign: "center",
        color: "#94a3b8",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div style={{ fontSize: 36 }}>📦</div>
      <div style={{ color: "#cbd5e1", fontWeight: 800, fontSize: 16 }}>No inventory yet</div>
      <div style={{ maxWidth: 460, fontSize: 13, lineHeight: 1.55 }}>
        Manual marketplace listings show up here as soon as you create them. If LeafLink inventory sync is enabled,
        synced items also appear here.
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
        <Link
          href="/sales/seller"
          style={{
            display: "inline-flex",
            padding: "10px 16px",
            borderRadius: 12,
            border: "1px solid rgba(167,139,250,0.55)",
            background: "linear-gradient(135deg, rgba(91,33,182,0.45), rgba(30,41,59,0.95))",
            color: "#fff",
            fontWeight: 800,
            textDecoration: "none",
            fontSize: 13,
          }}
        >
          + Add a product
        </Link>
      </div>
    </div>
  );
}
