import * as XLSX from "xlsx";
import type { LeafLinkInventoryItemDto } from "@/lib/api";
import { inferSourcePackageGroup } from "@/lib/leafLinkInventoryDisplay";
import { resolveInventoryCategoryLabel, type CategoryLabelOverride } from "@/lib/productCategoryLabels";

export type InventoryFilterState = {
  query: string;
  categoryFilter: string;
  subcategoryFilter: string;
  brandFilter: string;
  statusFilter: string;
  availabilityFilter: "in_stock" | "all";
  sortBy: string;
  sortDir: string;
  layoutMode: string;
};

export const INVENTORY_EXPORT_COLUMN_ORDER = [
  "product",
  "brand",
  "sku",
  "strain",
  "category",
  "subcategory",
  "qty",
  "package",
  "price",
  "status",
  "sourcePackage",
] as const;

export type InventoryExportColumnId = (typeof INVENTORY_EXPORT_COLUMN_ORDER)[number];

export const INVENTORY_EXPORT_COLUMN_LABELS: Record<InventoryExportColumnId, string> = {
  product: "Product",
  brand: "Brand",
  sku: "SKU",
  strain: "Strain",
  category: "Category",
  subcategory: "Subcategory",
  qty: "Qty",
  package: "Package",
  price: "Price",
  status: "Status",
  sourcePackage: "Source package",
};

export const DEFAULT_INVENTORY_EXPORT_COLUMNS: InventoryExportColumnId[] = [...INVENTORY_EXPORT_COLUMN_ORDER];

const COLUMN_ID_SET = new Set<string>(INVENTORY_EXPORT_COLUMN_ORDER);

/** Keep only known ids, preserve table order; if empty, return full default set. */
export function normalizeInventoryExportColumns(selected: unknown): InventoryExportColumnId[] {
  if (!Array.isArray(selected)) return [...DEFAULT_INVENTORY_EXPORT_COLUMNS];
  const picked = new Set(
    selected.filter((x): x is InventoryExportColumnId => typeof x === "string" && COLUMN_ID_SET.has(x)),
  );
  if (picked.size === 0) return [...DEFAULT_INVENTORY_EXPORT_COLUMNS];
  return INVENTORY_EXPORT_COLUMN_ORDER.filter((id) => picked.has(id));
}

export function clampInventoryLogoMaxWidthPx(n: unknown): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 160;
  return Math.min(400, Math.max(48, Math.round(x)));
}

export type InventoryPrintBranding = {
  logoUrl: string;
  logoMaxWidthPx: number;
};

export type InventoryExportOptions = {
  columns: InventoryExportColumnId[];
  /** Shown on printable sheet only (Excel does not embed images). */
  printBranding?: InventoryPrintBranding;
  /** API origin (e.g. from `NEXT_PUBLIC_API_URL`) so `/uploads/...` logos load in print preview. */
  apiBaseUrl?: string;
};

function usd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

/** Lines describing active filters (for print / Excel preamble). */
export function describeInventoryFilters(state: InventoryFilterState): string[] {
  const lines: string[] = [];
  const q = state.query.trim();
  if (q) lines.push(`Search: "${q}"`);
  if (state.categoryFilter !== "all") lines.push(`Category: ${state.categoryFilter}`);
  if (state.subcategoryFilter !== "all") lines.push(`Subcategory: ${state.subcategoryFilter}`);
  if (state.brandFilter !== "all") lines.push(`Brand: ${state.brandFilter}`);
  if (state.statusFilter !== "all") lines.push(`Status: ${state.statusFilter}`);
  lines.push(
    state.availabilityFilter === "in_stock" ? "Availability: In stock only" : "Availability: All SKUs",
  );
  lines.push(`Sort: ${state.sortBy} (${state.sortDir})`);
  lines.push(
    state.layoutMode === "grouped"
      ? "Screen view: grouped by source package (export is full flat list)"
      : "Screen view: flat list",
  );
  return lines;
}

/** Resolve stored logo URL (absolute or `/uploads/...`) for use in `<img src>`. */
export function resolveAssetUrlForPrint(url: string, apiBaseUrl: string): string {
  const u = (url || "").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  const base = (apiBaseUrl || "").replace(/\/+$/, "");
  if (!base) return u;
  if (u.startsWith("/")) return `${base}${u}`;
  return `${base}/${u}`;
}

type RowStrings = Record<InventoryExportColumnId, string>;

function rowDisplayStrings(
  row: LeafLinkInventoryItemDto,
  categoryLabels: CategoryLabelOverride[] | undefined,
): RowStrings {
  const categoryDisplay = resolveInventoryCategoryLabel((row.category || "").trim(), categoryLabels);
  const sub = (row.subcategory || row.productType || "").trim();
  const pkg = inferSourcePackageGroup(row);
  const priceStr = row.price == null ? "—" : usd(row.price);
  const qtyStr = `${Number(row.availableQuantity) || 0} ${(row.unit || "").trim()}`.trim();
  return {
    product: row.productName || "—",
    brand: row.brand || "—",
    sku: row.sku || "—",
    strain: row.strain || "—",
    category: categoryDisplay || "—",
    subcategory: sub || "—",
    qty: qtyStr,
    package: row.packageSize || "—",
    price: priceStr,
    status: row.status || "—",
    sourcePackage: pkg,
  };
}

function rowExcelValues(
  row: LeafLinkInventoryItemDto,
  categoryLabels: CategoryLabelOverride[] | undefined,
): Record<InventoryExportColumnId, string | number> {
  const categoryDisplay = resolveInventoryCategoryLabel((row.category || "").trim(), categoryLabels);
  const sub = (row.subcategory || row.productType || "").trim();
  const pkg = inferSourcePackageGroup(row);
  const qty = Number(row.availableQuantity);
  const price = row.price == null ? "" : Number(row.price);
  return {
    product: row.productName || "",
    brand: row.brand || "",
    sku: row.sku || "",
    strain: row.strain || "",
    category: categoryDisplay || "",
    subcategory: sub || "",
    qty: Number.isFinite(qty) ? qty : 0,
    package: row.packageSize || "",
    price,
    status: row.status || "",
    sourcePackage: pkg,
  };
}

function excelFilename(): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  return `inventory-export-${stamp}.xlsx`;
}

/** Download `.xlsx` for all rows matching the current filter (full `filtered` array). */
export function downloadInventoryExcel(
  items: LeafLinkInventoryItemDto[],
  categoryLabels: CategoryLabelOverride[] | undefined,
  state: InventoryFilterState,
  options: InventoryExportOptions,
): void {
  if (items.length === 0) return;

  const cols = normalizeInventoryExportColumns(options.columns);
  const filterLines = describeInventoryFilters(state);
  const colTitles = cols.map((id) => INVENTORY_EXPORT_COLUMN_LABELS[id]).join(", ");
  const preamble: (string | number)[][] = [
    ["LeafLink inventory export"],
    [`Generated: ${new Date().toLocaleString()}`],
    [`SKU count: ${items.length}`],
    [`Filters — ${filterLines.join(" · ")}`],
    [`Columns — ${colTitles}`],
    [],
  ];

  const headerRow = cols.map((id) => INVENTORY_EXPORT_COLUMN_LABELS[id]);
  const dataRows = items.map((row) => {
    const cells = rowExcelValues(row, categoryLabels);
    return cols.map((id) => cells[id]);
  });
  const aoa: (string | number)[][] = [...preamble, headerRow, ...dataRows];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Inventory");
  XLSX.writeFile(wb, excelFilename());
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildTableHeaderHtml(cols: InventoryExportColumnId[]): string {
  return cols.map((id) => `<th>${escapeHtml(INVENTORY_EXPORT_COLUMN_LABELS[id])}</th>`).join("");
}

function buildTableRowHtml(row: LeafLinkInventoryItemDto, categoryLabels: CategoryLabelOverride[] | undefined, cols: InventoryExportColumnId[]): string {
  const cells = rowDisplayStrings(row, categoryLabels);
  const tds = cols
    .map((id) => {
      const cls = id === "qty" || id === "price" ? ' class="num"' : "";
      return `<td${cls}>${escapeHtml(cells[id])}</td>`;
    })
    .join("");
  return `<tr>${tds}</tr>`;
}

/** Opens a print-friendly window with the full filtered list and triggers the browser print dialog. */
export function openInventoryPrintWindow(
  items: LeafLinkInventoryItemDto[],
  categoryLabels: CategoryLabelOverride[] | undefined,
  state: InventoryFilterState,
  options: InventoryExportOptions,
): void {
  if (items.length === 0) return;

  const cols = normalizeInventoryExportColumns(options.columns);
  const filterLines = describeInventoryFilters(state);
  const filterHtml = filterLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");

  const branding = options.printBranding;
  const rawLogo = (branding?.logoUrl || "").trim();
  const logoResolved = rawLogo ? resolveAssetUrlForPrint(rawLogo, options.apiBaseUrl || "") : "";
  const showLogo = Boolean(logoResolved && /^https?:\/\//i.test(logoResolved));
  const logoW = branding ? clampInventoryLogoMaxWidthPx(branding.logoMaxWidthPx) : 160;
  const logoBlock = showLogo
    ? `<div class="print-logo-wrap"><img class="print-logo" src="${escapeHtml(logoResolved)}" alt="" width="${logoW}" style="width:${logoW}px;max-width:${logoW}px;height:auto;object-fit:contain;" /></div>`
    : "";

  const rowsHtml = items.map((row) => buildTableRowHtml(row, categoryLabels, cols)).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Inventory menu</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      color: #0f172a;
      margin: 0;
      padding: 24px;
      background: #fff;
    }
    .print-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 8px;
    }
    .print-top-main { flex: 1; min-width: 0; }
    .print-logo-wrap {
      flex-shrink: 0;
      max-width: 45%;
    }
    h1 {
      font-size: 1.75rem;
      margin: 0 0 8px;
      letter-spacing: -0.02em;
    }
    .meta {
      color: #475569;
      font-size: 0.875rem;
      margin-bottom: 20px;
    }
    .filters {
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 12px 16px;
      margin-bottom: 24px;
      background: #f8fafc;
    }
    .filters h2 {
      margin: 0 0 8px;
      font-size: 0.95rem;
      color: #334155;
    }
    .filters ul { margin: 0; padding-left: 1.25rem; }
    .filters li { margin: 4px 0; font-size: 0.875rem; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 6px 8px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: #e2e8f0;
      font-weight: 700;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #334155;
    }
    tr:nth-child(even) td { background: #f8fafc; }
    td.num { white-space: nowrap; }
    .footer {
      margin-top: 20px;
      font-size: 11px;
      color: #64748b;
    }
    @media print {
      body { padding: 12px; }
      .filters { break-inside: avoid; }
      .print-top { break-inside: avoid; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="print-top">
    <div class="print-top-main">
      <h1>Inventory menu</h1>
      <div class="meta">
        Generated ${escapeHtml(new Date().toLocaleString())} · ${items.length} SKU${items.length === 1 ? "" : "s"} · LeafLink inventory
      </div>
    </div>
    ${logoBlock}
  </div>
  <div class="filters">
    <h2>Current filters</h2>
    <ul>${filterHtml}</ul>
  </div>
  <table>
    <thead>
      <tr>${buildTableHeaderHtml(cols)}</tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <p class="footer">Printed from CPU Inventory — wholesale/unit pricing per LeafLink when present.</p>
</body>
</html>`;

  /**
   * Do not pass `noopener` in the window features string: Chromium then returns `null` from
   * `window.open` while still opening a tab, so we never get a handle to `document.write` the
   * printable HTML — user sees a permanent blank `about:blank` tab.
   */
  const w = window.open("about:blank", "_blank");
  if (!w) {
    printInventoryViaHiddenIframe(html);
    return;
  }
  try {
    w.document.open();
    w.document.write(html);
    w.document.close();
  } catch {
    try {
      w.close();
    } catch {
      /* ignore */
    }
    printInventoryViaHiddenIframe(html);
    return;
  }
  const triggerPrint = () => {
    try {
      w.focus();
      w.print();
    } catch {
      /* ignore */
    }
  };
  setTimeout(triggerPrint, 200);
}

function printInventoryViaHiddenIframe(html: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "Inventory print");
  iframe.setAttribute("sandbox", "allow-modals allow-same-origin allow-scripts");
  iframe.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;opacity:0;pointer-events:none;z-index:-1;border:none;";
  document.body.appendChild(iframe);
  const pwin = iframe.contentWindow;
  if (!pwin) {
    iframe.remove();
    return;
  }
  pwin.document.open();
  pwin.document.write(html);
  pwin.document.close();
  const cleanup = () => {
    try {
      iframe.remove();
    } catch {
      /* ignore */
    }
  };
  setTimeout(() => {
    try {
      pwin.focus();
      pwin.print();
    } finally {
      setTimeout(cleanup, 800);
    }
  }, 50);
}
