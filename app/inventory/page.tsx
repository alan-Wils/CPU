"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Nav from "@/components/Nav";
import PageAccessGate from "@/components/PageAccessGate";
import {
  API_BASE_URL,
  fetchLeafLinkInventory,
  getSelectedCompanyId,
  type LeafLinkInventoryItemDto,
} from "@/lib/api";
import {
  clearLeafLinkInventoryClientCache,
  fetchLeafLinkInventoryDeduped,
  leafLinkListRowToUiDto,
} from "@/lib/leafLinkInventoryClient";
import { CPU_TENANT_CHANGED_EVENT } from "@/lib/tenantEvents";
import { fetchCachedCompanyConfig } from "@/lib/configClient";
import {
  clampInventoryLogoMaxHeightPx,
  clampInventoryLogoMaxWidthPx,
  DEFAULT_INVENTORY_EXPORT_COLUMNS,
  downloadInventoryExcel,
  EXPORT_COLUMN_PRESET,
  fetchInventoryLogoDataUrl,
  INVENTORY_EXPORT_COLUMN_LABELS,
  INVENTORY_EXPORT_COLUMN_ORDER,
  openInventoryPrintWindow,
  parseStoredExportColumns,
  resolveLogoAbsoluteUrlForFetch,
  type InventoryExportColumnId,
} from "@/lib/inventoryExport";
import { groupInventoryBySourcePackage } from "@/lib/leafLinkInventoryDisplay";
import { resolveInventoryCategoryLabel, type CategoryLabelOverride } from "@/lib/productCategoryLabels";

function usd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

const PAGE_SIZE = 50;
const EXPORT_COLUMNS_STORAGE_KEY = "cpu.inventory.exportColumns";
/** Avoid remount/refocus refetch within this window (server also caches ~2 min). */
const INVENTORY_CLIENT_STALE_MS = 3 * 60_000;

/** LeafLink-style listing states; keeps the status dropdown valid before first sync. */
const LEAFLINK_STATUS_PRESETS = ["Archived", "Available", "Internal", "Unavailable"] as const;

export default function InventoryPage() {
  const [items, setItems] = useState<LeafLinkInventoryItemDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastSync, setLastSync] = useState<string>("");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [subcategoryFilter, setSubcategoryFilter] = useState("all");
  const [brandFilter, setBrandFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("Available");
  /** Default: only rows with quantity available for sale (matches typical “available” inventory). */
  const [availabilityFilter, setAvailabilityFilter] = useState<"in_stock" | "all">("in_stock");
  const [sortBy, setSortBy] = useState<"name" | "qty" | "price" | "updated">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [layoutMode, setLayoutMode] = useState<"flat" | "grouped">("grouped");
  const [fromCache, setFromCache] = useState(false);
  const [syncMode, setSyncMode] = useState<"" | "cache" | "full" | "incremental">("");
  const [categoryLabels, setCategoryLabels] = useState<CategoryLabelOverride[]>([]);
  /** Grouped view: which source-package rows are expanded (same table as thead — no nested table shift). */
  const [openSourcePackages, setOpenSourcePackages] = useState<Record<string, boolean>>({});
  const [exportColumns, setExportColumns] = useState<InventoryExportColumnId[]>(() => [...EXPORT_COLUMN_PRESET]);
  const [exportColumnPrefsMessage, setExportColumnPrefsMessage] = useState("");
  const [printBrandingLogoUrl, setPrintBrandingLogoUrl] = useState("");
  const [printBrandingLogoMaxWidthPx, setPrintBrandingLogoMaxWidthPx] = useState(160);
  const [printBrandingLogoMaxHeightPx, setPrintBrandingLogoMaxHeightPx] = useState(0);
  const lastInventoryFetchAtRef = useRef(0);

  useEffect(() => {
    const onTenant = () => {
      clearLeafLinkInventoryClientCache();
      lastInventoryFetchAtRef.current = 0;
    };
    window.addEventListener(CPU_TENANT_CHANGED_EVENT, onTenant);
    return () => window.removeEventListener(CPU_TENANT_CHANGED_EVENT, onTenant);
  }, []);

  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(EXPORT_COLUMNS_STORAGE_KEY) : null;
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      const restored = parseStoredExportColumns(parsed);
      if (restored && restored.length > 0) {
        setExportColumns(restored);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const saveExportColumnPrefs = useCallback(() => {
    try {
      window.localStorage.setItem(EXPORT_COLUMNS_STORAGE_KEY, JSON.stringify(exportColumns));
      setExportColumnPrefsMessage("Column preferences saved on this browser.");
      window.setTimeout(() => setExportColumnPrefsMessage(""), 4000);
    } catch {
      setExportColumnPrefsMessage("Could not save (storage may be blocked).");
      window.setTimeout(() => setExportColumnPrefsMessage(""), 4000);
    }
  }, [exportColumns]);

  const resetExportColumnPrefs = useCallback(() => {
    try {
      window.localStorage.removeItem(EXPORT_COLUMNS_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setExportColumns([...EXPORT_COLUMN_PRESET]);
    setExportColumnPrefsMessage("Reset to Product and Qty. Preferences no longer saved.");
    window.setTimeout(() => setExportColumnPrefsMessage(""), 4000);
  }, []);

  const toggleExportColumn = useCallback((id: InventoryExportColumnId) => {
    setExportColumns((prev) => {
      const set = new Set(prev);
      if (set.has(id)) {
        if (set.size <= 1) return prev;
        set.delete(id);
      } else {
        set.add(id);
      }
      return INVENTORY_EXPORT_COLUMN_ORDER.filter((k) => set.has(k));
    });
  }, []);

  async function loadProductsConfig() {
    try {
      const companyId = getSelectedCompanyId().trim();
      const data = await fetchCachedCompanyConfig<{
        sales?: {
          leafLinkCategoryLabels?: CategoryLabelOverride[];
          inventoryPrintLogoUrl?: string;
          inventoryPrintLogoMaxWidthPx?: unknown;
          inventoryPrintLogoMaxHeightPx?: unknown;
        };
        products?: { categoryLabels?: CategoryLabelOverride[] };
      }>("/api/config/basic", { companyId: companyId || undefined });
      if (
        data.sales &&
        "leafLinkCategoryLabels" in data.sales &&
        Array.isArray(data.sales.leafLinkCategoryLabels)
      ) {
        setCategoryLabels(data.sales.leafLinkCategoryLabels);
      } else {
        const legacy = data.products?.categoryLabels;
        setCategoryLabels(Array.isArray(legacy) ? legacy : []);
      }
      const logo =
        typeof data.sales?.inventoryPrintLogoUrl === "string" ? data.sales.inventoryPrintLogoUrl.trim() : "";
      setPrintBrandingLogoUrl(logo);
      setPrintBrandingLogoMaxWidthPx(clampInventoryLogoMaxWidthPx(data.sales?.inventoryPrintLogoMaxWidthPx));
    } catch {
      /* non-fatal */
    }
  }

  async function loadInventory(opts?: { refresh?: boolean }) {
    const refresh = Boolean(opts?.refresh);
    const now = Date.now();
    if (!refresh && lastInventoryFetchAtRef.current > 0 && now - lastInventoryFetchAtRef.current < INVENTORY_CLIENT_STALE_MS) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const out = await fetchLeafLinkInventoryDeduped(() => fetchLeafLinkInventory(undefined, { refresh }), {
        refresh,
      });
      const rows = (out.items || []).map((row) => leafLinkListRowToUiDto(row));
      lastInventoryFetchAtRef.current = Date.now();
      setItems(rows);
      setLastSync(out.lastSyncedAt || new Date().toISOString());
      setFromCache(Boolean(out.fromCache));
      setSyncMode((out.syncMode as "" | "cache" | "full" | "incremental") || "");
      setPage(1);
      void loadProductsConfig();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not load inventory.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProductsConfig();
    void loadInventory();
  }, []);

  useEffect(() => {
    setSubcategoryFilter("all");
  }, [categoryFilter]);

  const categories = useMemo(
    () =>
      Array.from(
        new Set(
          items
            .map((x) => resolveInventoryCategoryLabel((x.category || "").trim(), categoryLabels))
            .filter(Boolean),
        ),
      ).sort(),
    [items, categoryLabels],
  );
  const brands = useMemo(
    () => Array.from(new Set(items.map((x) => (x.brand || "").trim()).filter(Boolean))).sort(),
    [items],
  );
  const subcategoriesInScope = useMemo(() => {
    const scoped = items.filter((row) => {
      if (categoryFilter === "all") return true;
      const displayCat = resolveInventoryCategoryLabel((row.category || "").trim(), categoryLabels);
      return displayCat === categoryFilter;
    });
    const raw = scoped.map((x) => (x.subcategory || x.productType || "").trim()).filter(Boolean);
    return Array.from(new Set(raw)).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [items, categoryFilter, categoryLabels]);

  const statuses = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of LEAFLINK_STATUS_PRESETS)
      map.set(p.toLowerCase(), p);
    for (const raw of items.map((x) => (x.status || "").trim()).filter(Boolean)) {
      const k = raw.toLowerCase();
      if (!map.has(k))
        map.set(k, raw);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const arr = items.filter((row) => {
      if (availabilityFilter === "in_stock" && !(Number(row.availableQuantity) > 0)) return false;
      const displayCat = resolveInventoryCategoryLabel((row.category || "").trim(), categoryLabels);
      if (categoryFilter !== "all" && displayCat !== categoryFilter) return false;
      if (subcategoryFilter !== "all") {
        const sub = (row.subcategory || row.productType || "").trim().toLowerCase();
        if (sub !== subcategoryFilter.trim().toLowerCase()) return false;
      }
      if (brandFilter !== "all" && row.brand !== brandFilter) return false;
      if (statusFilter !== "all") {
        const a = (row.status || "").trim().toLowerCase();
        const b = statusFilter.trim().toLowerCase();
        if (a !== b) return false;
      }
      if (!q) return true;
      return [
        row.productName,
        row.sku,
        row.strain,
        row.category,
        displayCat,
        row.brand,
        row.productType,
        row.subcategory,
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
  }, [items, query, availabilityFilter, categoryFilter, subcategoryFilter, brandFilter, statusFilter, sortBy, sortDir, categoryLabels]);

  const packageGroups = useMemo(() => groupInventoryBySourcePackage(filtered), [filtered]);

  const totalPages =
    layoutMode === "flat"
      ? Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
      : Math.max(1, Math.ceil(packageGroups.length / PAGE_SIZE));

  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageGroups = packageGroups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const stats = useMemo(() => {
    const totalInventoryUnits = filtered.reduce((sum, x) => sum + (Number(x.availableQuantity) || 0), 0);
    const totalInventoryValue = filtered.reduce((sum, x) => sum + ((x.price || 0) * (x.availableQuantity || 0)), 0);
    const categoriesCount = new Set(
      filtered.map((x) => resolveInventoryCategoryLabel((x.category || "").trim(), categoryLabels)).filter(Boolean),
    ).size;
    return {
      totalSkus: filtered.length,
      totalInventoryUnits,
      totalInventoryValue,
      categoriesCount,
    };
  }, [filtered, categoryLabels]);

  return (
    <PageAccessGate permission="page.inventory">
      <main style={pageStyle}>
        <div style={{ maxWidth: 1280, margin: "0 auto" }}>
          <header style={headerStyle}>
            <div>
              <div style={badgeStyle}>LeafLink Source</div>
              <h1 style={{ margin: 0, fontSize: 38, fontWeight: 900 }}>Inventory</h1>
              <p style={{ color: "#94a3b8", marginTop: 10, marginBottom: 0 }}>
                Live available-for-sale inventory synced from LeafLink via backend company-scoped credentials. Category
                display names can be overridden under{" "}
                <b style={{ color: "#cbd5e1" }}>Admin → Company Config → Sales → LeafLink category names</b>.{" "}
                <span style={{ color: "#64748b" }}>
                  Total inventory value uses each line&apos;s wholesale/unit price from LeafLink when present; run{" "}
                  <b style={{ color: "#94a3b8" }}>Sync / Refresh</b> after catalog changes.
                </span>
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ color: "#64748b", fontSize: 12, maxWidth: 420, lineHeight: 1.45 }}>
                <div>
                  Last sync: {lastSync ? new Date(lastSync).toLocaleString() : "Not synced yet"}
                </div>
                {fromCache ? (
                  <div style={{ color: "#94a3b8", marginTop: 4 }}>
                    Showing saved snapshot (fast). Use &quot;Sync / Refresh&quot; to pull changes from LeafLink.
                  </div>
                ) : syncMode === "incremental" ? (
                  <div style={{ color: "#86efac", marginTop: 4, fontSize: 11 }}>
                    Merged incremental updates from LeafLink.
                  </div>
                ) : syncMode === "full" ? (
                  <div style={{ color: "#86efac", marginTop: 4, fontSize: 11 }}>
                    Full catalog pull from LeafLink.
                  </div>
                ) : null}
              </div>
              <button onClick={() => void loadInventory({ refresh: true })} style={syncButtonStyle} disabled={loading}>
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
              <select style={inputStyle} value={subcategoryFilter} onChange={(e) => { setSubcategoryFilter(e.target.value); setPage(1); }}>
                <option value="all">All subcategories</option>
                {subcategoriesInScope.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <select style={inputStyle} value={brandFilter} onChange={(e) => { setBrandFilter(e.target.value); setPage(1); }}>
                <option value="all">All brands</option>
                {brands.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <select style={inputStyle} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
                <option value="all">All status</option>
                {statuses.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <select
                style={inputStyle}
                value={availabilityFilter}
                onChange={(e) => {
                  setAvailabilityFilter(e.target.value as "in_stock" | "all");
                  setPage(1);
                }}
              >
                <option value="in_stock">Availability: In stock</option>
                <option value="all">Availability: All SKUs</option>
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
              <select
                style={inputStyle}
                value={layoutMode}
                onChange={(e) => {
                  setLayoutMode(e.target.value as "flat" | "grouped");
                  setPage(1);
                }}
              >
                <option value="flat">View: every SKU (flat)</option>
                <option value="grouped">View: by source package</option>
              </select>
              <div
                style={{
                  gridColumn: "1 / -1",
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "stretch",
                  justifyContent: "space-between",
                  gap: 12,
                  marginTop: 4,
                  paddingTop: 12,
                  borderTop: "1px solid rgba(148,163,184,0.15)",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", minHeight: 40 }}>
                  <span style={{ color: "#64748b", fontSize: 12 }}>
                    {loading ? "Loading…" : `${filtered.length} SKU${filtered.length === 1 ? "" : "s"} match current filters`}
                  </span>
                </div>
                <details style={exportDetailsStyle}>
                  <summary style={exportSummaryStyle}>Export current filter</summary>
                  <div style={{ marginTop: 12 }}>
                    <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 6 }}>
                      Columns on Excel and print — default is <b style={{ color: "#cbd5e1" }}>Product</b> and{" "}
                      <b style={{ color: "#cbd5e1" }}>Qty</b>. Check others, then{" "}
                      <b style={{ color: "#cbd5e1" }}>Save column preferences</b> to remember on this browser.
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "6px 14px",
                        marginBottom: 10,
                        maxWidth: 720,
                      }}
                    >
                      {INVENTORY_EXPORT_COLUMN_ORDER.map((id) => (
                        <label
                          key={id}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            cursor: "pointer",
                            fontSize: 13,
                            color: "#cbd5e1",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={exportColumns.includes(id)}
                            onChange={() => toggleExportColumn(id)}
                          />
                          {INVENTORY_EXPORT_COLUMN_LABELS[id]}
                        </label>
                      ))}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10, alignItems: "center" }}>
                      <button type="button" style={exportActionButtonStyle} onClick={saveExportColumnPrefs}>
                        Save column preferences
                      </button>
                      <button type="button" style={exportActionButtonStyle} onClick={resetExportColumnPrefs}>
                        Reset to Product + Qty
                      </button>
                      <button
                        type="button"
                        style={exportActionButtonStyle}
                        onClick={() => setExportColumns([...DEFAULT_INVENTORY_EXPORT_COLUMNS])}
                      >
                        Select all columns
                      </button>
                    </div>
                    {exportColumnPrefsMessage ? (
                      <div
                        style={{
                          color: exportColumnPrefsMessage.startsWith("Could") ? "#fdba74" : "#86efac",
                          fontSize: 12,
                          marginBottom: 10,
                        }}
                      >
                        {exportColumnPrefsMessage}
                      </div>
                    ) : null}
                  </div>
                  <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 8 }}>
                    <button
                      type="button"
                      style={exportActionButtonStyle}
                      disabled={loading || filtered.length === 0}
                      onClick={(e) => {
                        e.preventDefault();
                        const filterState = {
                          query,
                          categoryFilter,
                          subcategoryFilter,
                          brandFilter,
                          statusFilter,
                          availabilityFilter,
                          sortBy,
                          sortDir,
                          layoutMode,
                        };
                        const exportOpts = {
                          columns: exportColumns,
                          apiBaseUrl: API_BASE_URL,
                        };
                        downloadInventoryExcel(filtered, categoryLabels, filterState, exportOpts);
                      }}
                    >
                      Download Excel (.xlsx)
                    </button>
                    <button
                      type="button"
                      style={exportActionButtonStyle}
                      disabled={loading || filtered.length === 0}
                      onClick={(e) => {
                        e.preventDefault();
                        void (async () => {
                          const filterState = {
                            query,
                            categoryFilter,
                            subcategoryFilter,
                            brandFilter,
                            statusFilter,
                            availabilityFilter,
                            sortBy,
                            sortDir,
                            layoutMode,
                          };
                          const rawLogo = printBrandingLogoUrl.trim();
                          let logoDataUrl: string | undefined;
                          if (rawLogo) {
                            const abs = resolveLogoAbsoluteUrlForFetch(rawLogo, API_BASE_URL);
                            if (abs) {
                              logoDataUrl = (await fetchInventoryLogoDataUrl(abs)) ?? undefined;
                            }
                          }
                          const exportOpts = {
                            columns: exportColumns,
                            apiBaseUrl: API_BASE_URL,
                            printBranding: rawLogo
                              ? {
                                  logoUrl: rawLogo,
                                  logoMaxWidthPx: printBrandingLogoMaxWidthPx,
                                  ...(printBrandingLogoMaxHeightPx > 0
                                    ? { logoMaxHeightPx: printBrandingLogoMaxHeightPx }
                                    : {}),
                                  ...(logoDataUrl ? { logoDataUrl } : {}),
                                }
                              : undefined,
                          };
                          openInventoryPrintWindow(filtered, categoryLabels, filterState, exportOpts);
                        })();
                      }}
                    >
                      Printable menu (print / PDF)
                    </button>
                  </div>
                  <p style={{ color: "#64748b", fontSize: 11, marginTop: 10, marginBottom: 0, maxWidth: 520, lineHeight: 1.45 }}>
                    Logo (Admin → Company Config → Sales) is embedded into the printable sheet when the browser can
                    fetch it (HTTPS / CORS). Excel still has no embedded image.
                  </p>
                  {filtered.length === 0 && !loading ? (
                    <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 8, maxWidth: 320 }}>
                      Nothing to export yet — widen filters or sync inventory from LeafLink.
                    </div>
                  ) : null}
                </details>
              </div>
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
                  <table style={{ ...tableStyle, tableLayout: "fixed" }}>
                    <colgroup>
                      <col style={{ width: "22%" }} />
                      <col style={{ width: "11%" }} />
                      <col style={{ width: "9%" }} />
                      <col style={{ width: "10%" }} />
                      <col style={{ width: "11%" }} />
                      <col style={{ width: "9%" }} />
                      <col style={{ width: "8%" }} />
                      <col style={{ width: "8%" }} />
                      <col style={{ width: "12%" }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th style={thStyle}>Product</th>
                        <th style={thStyle}>SKU</th>
                        <th style={thStyle}>Strain</th>
                        <th style={thStyle}>Category</th>
                        <th style={thStyle}>Subcategory</th>
                        <th style={thStyle}>Qty</th>
                        <th style={thStyle}>Package</th>
                        <th style={thStyle}>Price</th>
                        <th style={thStyle}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {layoutMode === "flat"
                        ? pageItems.map((row) => (
                            <InventoryProductRow key={row.id} row={row} categoryLabels={categoryLabels} />
                          ))
                        : pageGroups.map((g) => (
                            <Fragment key={g.key}>
                              <tr style={{ borderTop: "1px solid rgba(51,65,85,0.6)", background: "rgba(15,23,42,0.5)" }}>
                                <td colSpan={9} style={{ ...tdStyle, paddingBottom: 8 }}>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setOpenSourcePackages((prev) => ({
                                        ...prev,
                                        [g.key]: !prev[g.key],
                                      }))
                                    }
                                    style={{
                                      width: "100%",
                                      textAlign: "left",
                                      cursor: "pointer",
                                      background: "transparent",
                                      border: "none",
                                      color: "#7dd3fc",
                                      fontWeight: 800,
                                      fontFamily: "inherit",
                                      fontSize: 14,
                                      padding: "4px 0",
                                    }}
                                    aria-expanded={Boolean(openSourcePackages[g.key])}
                                  >
                                    <span aria-hidden>{openSourcePackages[g.key] ? "▼ " : "▶ "}</span>
                                    Source package <span style={{ color: "#e2e8f0" }}>{g.key}</span>
                                    <span style={{ color: "#94a3b8", fontWeight: 600, marginLeft: 8 }}>
                                      —
                                      {g.rows.length === 1
                                        ? " 1 SKU"
                                        : ` ${g.rows.length} sizes / SKUs`}
                                    </span>
                                  </button>
                                </td>
                              </tr>
                              {openSourcePackages[g.key]
                                ? g.rows.map((row) => (
                                    <InventoryProductRow
                                      key={row.id}
                                      row={row}
                                      categoryLabels={categoryLabels}
                                    />
                                  ))
                                : null}
                            </Fragment>
                          ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
                  <span style={{ color: "#64748b", fontSize: 12 }}>
                    {layoutMode === "flat" ? (
                      <>
                        Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}{" "}
                        SKUs
                      </>
                    ) : (
                      <>
                        Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, packageGroups.length)} of{" "}
                        {packageGroups.length} source packages ({filtered.length} SKUs)
                      </>
                    )}
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

function InventoryProductRow({
  row,
  nested,
  categoryLabels,
}: {
  row: LeafLinkInventoryItemDto;
  nested?: boolean;
  categoryLabels?: CategoryLabelOverride[];
}) {
  const pad = nested ? { ...tdStyle, padding: "8px 6px", fontSize: 12 as const } : tdStyle;
  const categoryDisplay = resolveInventoryCategoryLabel((row.category || "").trim(), categoryLabels);
  return (
    <tr style={{ borderTop: nested ? "1px solid rgba(51,65,85,0.45)" : "1px solid rgba(51,65,85,0.6)" }}>
      <td style={pad}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {row.imageUrl ? (
            <img
              src={row.imageUrl}
              alt={row.productName || "inventory image"}
              style={{
                width: nested ? 28 : 34,
                height: nested ? 28 : 34,
                borderRadius: 8,
                objectFit: "cover",
                border: "1px solid #334155",
              }}
            />
          ) : (
            <div
              style={{
                width: nested ? 28 : 34,
                height: nested ? 28 : 34,
                borderRadius: 8,
                background: "#0f172a",
                border: "1px solid #334155",
              }}
            />
          )}
          <div>
            <div style={{ color: "#e2e8f0", fontWeight: 700 }}>{row.productName || "Unnamed product"}</div>
            <div style={{ color: "#64748b", fontSize: nested ? 11 : 12 }}>
              {row.brand || "—"} · {(row.subcategory || row.productType) || "—"}
            </div>
          </div>
        </div>
      </td>
      <td style={pad}>{row.sku || "—"}</td>
      <td style={pad}>{row.strain || "—"}</td>
      <td style={pad}>{categoryDisplay || "—"}</td>
      <td style={pad}>{(row.subcategory || row.productType || "—").trim() || "—"}</td>
      <td style={pad}>
        {row.availableQuantity} {row.unit || ""}
      </td>
      <td style={pad}>{row.packageSize || "—"}</td>
      <td style={pad}>{row.price == null ? "—" : usd(row.price)}</td>
      <td style={pad}>{row.status || "—"}</td>
    </tr>
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
const exportDetailsStyle: React.CSSProperties = {
  border: "1px solid rgba(56,189,248,0.35)",
  borderRadius: 12,
  padding: "10px 14px",
  background: "rgba(8,47,73,0.45)",
  color: "#bae6fd",
  maxWidth: "100%",
};
const exportSummaryStyle: React.CSSProperties = {
  cursor: "pointer",
  fontWeight: 800,
  fontSize: 13,
};
const exportActionButtonStyle: React.CSSProperties = {
  border: "1px solid rgba(148,163,184,0.4)",
  borderRadius: 10,
  padding: "8px 12px",
  background: "#020617",
  color: "#e2e8f0",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
};

