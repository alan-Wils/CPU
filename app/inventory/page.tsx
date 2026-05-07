"use client";

import { useEffect, useMemo, useState } from "react";
import Nav from "@/components/Nav";
import PageAccessGate from "@/components/PageAccessGate";
import { fetchLeafLinkInventory, type LeafLinkInventoryItemDto } from "@/lib/api";

function usd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

const PAGE_SIZE = 50;

export default function InventoryPage() {
  const [items, setItems] = useState<LeafLinkInventoryItemDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastSync, setLastSync] = useState<string>("");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [brandFilter, setBrandFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"name" | "qty" | "price" | "updated">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  async function runSync() {
    setLoading(true);
    setError("");
    try {
      const out = await fetchLeafLinkInventory();
      setItems(out.items || []);
      setLastSync(out.lastSyncedAt || new Date().toISOString());
      setPage(1);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not load inventory.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void runSync();
  }, []);

  const categories = useMemo(
    () => Array.from(new Set(items.map((x) => (x.category || "").trim()).filter(Boolean))).sort(),
    [items],
  );
  const brands = useMemo(
    () => Array.from(new Set(items.map((x) => (x.brand || "").trim()).filter(Boolean))).sort(),
    [items],
  );
  const statuses = useMemo(
    () => Array.from(new Set(items.map((x) => (x.status || "").trim()).filter(Boolean))).sort(),
    [items],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const arr = items.filter((row) => {
      if (categoryFilter !== "all" && row.category !== categoryFilter) return false;
      if (brandFilter !== "all" && row.brand !== brandFilter) return false;
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (!q) return true;
      return [
        row.productName,
        row.sku,
        row.strain,
        row.category,
        row.brand,
        row.productType,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });

    arr.sort((a, b) => {
      const mul = sortDir === "asc" ? 1 : -1;
      if (sortBy === "qty") return (a.availableQuantity - b.availableQuantity) * mul;
      if (sortBy === "price") return ((a.price || 0) - (b.price || 0)) * mul;
      if (sortBy === "updated") return (Date.parse(a.updatedAt || "") - Date.parse(b.updatedAt || "")) * mul;
      return a.productName.localeCompare(b.productName) * mul;
    });
    return arr;
  }, [items, query, categoryFilter, brandFilter, statusFilter, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const stats = useMemo(() => {
    const totalInventoryUnits = filtered.reduce((sum, x) => sum + (Number(x.availableQuantity) || 0), 0);
    const totalInventoryValue = filtered.reduce((sum, x) => sum + ((x.price || 0) * (x.availableQuantity || 0)), 0);
    const categoriesCount = new Set(filtered.map((x) => x.category).filter(Boolean)).size;
    return {
      totalSkus: filtered.length,
      totalInventoryUnits,
      totalInventoryValue,
      categoriesCount,
    };
  }, [filtered]);

  return (
    <PageAccessGate permission="page.inventory">
      <main style={pageStyle}>
        <div style={{ maxWidth: 1280, margin: "0 auto" }}>
          <header style={headerStyle}>
            <div>
              <div style={badgeStyle}>LeafLink Source</div>
              <h1 style={{ margin: 0, fontSize: 38, fontWeight: 900 }}>Inventory</h1>
              <p style={{ color: "#94a3b8", marginTop: 10, marginBottom: 0 }}>
                Live available-for-sale inventory synced from LeafLink via backend company-scoped credentials.
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ color: "#64748b", fontSize: 12 }}>
                Last sync: {lastSync ? new Date(lastSync).toLocaleString() : "Not synced yet"}
              </div>
              <button onClick={() => void runSync()} style={syncButtonStyle} disabled={loading}>
                {loading ? "Syncing..." : "Sync / Refresh"}
              </button>
            </div>
            <div style={{ marginTop: 18 }}>
              <Nav />
            </div>
          </header>

          {error ? <div style={errorStyle}>{error}</div> : null}

          <section style={statsGridStyle}>
            <StatCard label="Total SKUs" value={String(stats.totalSkus)} />
            <StatCard label="Total Inventory Units" value={String(stats.totalInventoryUnits)} />
            <StatCard label="Total Inventory Value" value={usd(stats.totalInventoryValue)} />
            <StatCard label="Categories Count" value={String(stats.categoriesCount)} />
          </section>

          <section style={panelStyle}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <input
                  style={inputStyle}
                  placeholder="Search by product, SKU, strain, category, brand..."
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <select style={inputStyle} value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}>
                <option value="all">All categories</option>
                {categories.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <select style={inputStyle} value={brandFilter} onChange={(e) => { setBrandFilter(e.target.value); setPage(1); }}>
                <option value="all">All brands</option>
                {brands.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <select style={inputStyle} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
                <option value="all">All status</option>
                {statuses.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <select style={inputStyle} value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}>
                <option value="name">Sort: Name</option>
                <option value="qty">Sort: Quantity</option>
                <option value="price">Sort: Price</option>
                <option value="updated">Sort: Updated</option>
              </select>
              <select style={inputStyle} value={sortDir} onChange={(e) => setSortDir(e.target.value as any)}>
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </div>

            {loading ? (
              <div style={{ marginTop: 18, color: "#93c5fd", fontWeight: 700 }}>Loading inventory...</div>
            ) : filtered.length === 0 ? (
              <div style={{ marginTop: 18, color: "#94a3b8" }}>
                No inventory found. Sync now, verify LeafLink credentials, or adjust filters.
              </div>
            ) : (
              <>
                <div style={{ overflowX: "auto", marginTop: 14 }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Product</th>
                        <th style={thStyle}>SKU</th>
                        <th style={thStyle}>Strain</th>
                        <th style={thStyle}>Category</th>
                        <th style={thStyle}>Qty</th>
                        <th style={thStyle}>Package</th>
                        <th style={thStyle}>Price</th>
                        <th style={thStyle}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageItems.map((row) => (
                        <tr key={row.id} style={{ borderTop: "1px solid rgba(51,65,85,0.6)" }}>
                          <td style={tdStyle}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              {row.imageUrl ? (
                                <img
                                  src={row.imageUrl}
                                  alt={row.productName || "inventory image"}
                                  style={{ width: 34, height: 34, borderRadius: 8, objectFit: "cover", border: "1px solid #334155" }}
                                />
                              ) : (
                                <div style={{ width: 34, height: 34, borderRadius: 8, background: "#0f172a", border: "1px solid #334155" }} />
                              )}
                              <div>
                                <div style={{ color: "#e2e8f0", fontWeight: 700 }}>{row.productName || "Unnamed product"}</div>
                                <div style={{ color: "#64748b", fontSize: 12 }}>{row.brand || "—"} · {row.productType || "—"}</div>
                              </div>
                            </div>
                          </td>
                          <td style={tdStyle}>{row.sku || "—"}</td>
                          <td style={tdStyle}>{row.strain || "—"}</td>
                          <td style={tdStyle}>{row.category || "—"}</td>
                          <td style={tdStyle}>{row.availableQuantity} {row.unit || ""}</td>
                          <td style={tdStyle}>{row.packageSize || "—"}</td>
                          <td style={tdStyle}>{row.price == null ? "—" : usd(row.price)}</td>
                          <td style={tdStyle}>{row.status || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
                  <span style={{ color: "#64748b", fontSize: 12 }}>
                    Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
                  </span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button style={pageButtonStyle} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
                    <button style={pageButtonStyle} disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</button>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </main>
    </PageAccessGate>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={statCardStyle}>
      <div style={{ color: "#94a3b8", fontSize: 13 }}>{label}</div>
      <div style={{ color: "#f8fafc", fontWeight: 900, fontSize: 28 }}>{value}</div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background:
    "radial-gradient(circle at top left, rgba(34,197,94,0.16), transparent 30%), radial-gradient(circle at top right, rgba(56,189,248,0.14), transparent 32%), #020617",
  color: "white",
  padding: 24,
};
const headerStyle: React.CSSProperties = {
  background: "rgba(15,23,42,0.84)",
  border: "1px solid rgba(148,163,184,0.22)",
  borderRadius: 24,
  padding: 24,
  marginBottom: 18,
};
const badgeStyle: React.CSSProperties = {
  display: "inline-flex",
  borderRadius: 999,
  padding: "6px 12px",
  background: "rgba(14,165,233,0.14)",
  border: "1px solid rgba(14,165,233,0.35)",
  color: "#bae6fd",
  fontWeight: 800,
  fontSize: 12,
  marginBottom: 10,
};
const syncButtonStyle: React.CSSProperties = {
  border: "1px solid rgba(34,197,94,0.6)",
  borderRadius: 12,
  padding: "10px 14px",
  background: "rgba(20,83,45,0.45)",
  color: "#bbf7d0",
  fontWeight: 800,
  cursor: "pointer",
};
const statsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
  marginBottom: 16,
};
const statCardStyle: React.CSSProperties = {
  background: "rgba(15,23,42,0.84)",
  border: "1px solid rgba(148,163,184,0.22)",
  borderRadius: 16,
  padding: 14,
};
const panelStyle: React.CSSProperties = {
  background: "rgba(15,23,42,0.84)",
  border: "1px solid rgba(148,163,184,0.22)",
  borderRadius: 16,
  padding: 14,
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(148,163,184,0.3)",
  background: "#020617",
  color: "white",
};
const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
};
const thStyle: React.CSSProperties = {
  color: "#94a3b8",
  textAlign: "left",
  fontSize: 12,
  fontWeight: 800,
  padding: "10px 8px",
};
const tdStyle: React.CSSProperties = {
  color: "#cbd5e1",
  padding: "12px 8px",
  fontSize: 13,
  verticalAlign: "top",
};
const pageButtonStyle: React.CSSProperties = {
  border: "1px solid rgba(148,163,184,0.35)",
  borderRadius: 10,
  padding: "6px 10px",
  background: "#020617",
  color: "#cbd5e1",
  fontWeight: 700,
};
const errorStyle: React.CSSProperties = {
  marginBottom: 12,
  padding: 12,
  borderRadius: 12,
  background: "rgba(127,29,29,0.5)",
  border: "1px solid rgba(248,113,113,0.45)",
  color: "#fecaca",
};

