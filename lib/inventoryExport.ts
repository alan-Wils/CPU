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
    state.layoutMode === "grouped" ? "Screen view: grouped by source package (export is full flat list)" : "Screen view: flat list",
  );
  return lines;
}

const EXCEL_HEADERS = [
  "Product",
  "Brand",
  "SKU",
  "Strain",
  "Category",
  "Subcategory",
  "Quantity",
  "Unit",
  "Package",
  "Price",
  "Status",
  "Source package",
] as const;

function itemToExcelRow(
  row: LeafLinkInventoryItemDto,
  categoryLabels: CategoryLabelOverride[] | undefined,
): (string | number)[] {
  const categoryDisplay = resolveInventoryCategoryLabel((row.category || "").trim(), categoryLabels);
  const sub = (row.subcategory || row.productType || "").trim();
  const qty = Number(row.availableQuantity);
  const price = row.price == null ? "" : Number(row.price);
  return [
    row.productName || "",
    row.brand || "",
    row.sku || "",
    row.strain || "",
    categoryDisplay || "",
    sub || "",
    Number.isFinite(qty) ? qty : 0,
    row.unit || "",
    row.packageSize || "",
    price,
    row.status || "",
    inferSourcePackageGroup(row),
  ];
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
): void {
  if (items.length === 0) return;

  const filterLines = describeInventoryFilters(state);
  const preamble: (string | number)[][] = [
    ["LeafLink inventory export"],
    [`Generated: ${new Date().toLocaleString()}`],
    [`SKU count: ${items.length}`],
    [`Filters — ${filterLines.join(" · ")}`],
    [],
  ];

  const headerRow = [...EXCEL_HEADERS];
  const dataRows = items.map((row) => itemToExcelRow(row, categoryLabels));
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

/** Opens a print-friendly window with the full filtered list and triggers the browser print dialog. */
export function openInventoryPrintWindow(
  items: LeafLinkInventoryItemDto[],
  categoryLabels: CategoryLabelOverride[] | undefined,
  state: InventoryFilterState,
): void {
  if (items.length === 0) return;

  const filterLines = describeInventoryFilters(state);
  const filterHtml = filterLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");

  const rowsHtml = items
    .map((row) => {
      const categoryDisplay = resolveInventoryCategoryLabel((row.category || "").trim(), categoryLabels);
      const sub = (row.subcategory || row.productType || "").trim();
      const pkg = inferSourcePackageGroup(row);
      const priceStr = row.price == null ? "—" : usd(row.price);
      return `<tr>
  <td>${escapeHtml(row.productName || "—")}</td>
  <td>${escapeHtml(row.brand || "—")}</td>
  <td>${escapeHtml(row.sku || "—")}</td>
  <td>${escapeHtml(row.strain || "—")}</td>
  <td>${escapeHtml(categoryDisplay || "—")}</td>
  <td>${escapeHtml(sub || "—")}</td>
  <td class="num">${escapeHtml(`${Number(row.availableQuantity) || 0} ${(row.unit || "").trim()}`.trim())}</td>
  <td>${escapeHtml(row.packageSize || "—")}</td>
  <td class="num">${escapeHtml(priceStr)}</td>
  <td>${escapeHtml(row.status || "—")}</td>
  <td>${escapeHtml(pkg)}</td>
</tr>`;
    })
    .join("");

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
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <h1>Inventory menu</h1>
  <div class="meta">
    Generated ${escapeHtml(new Date().toLocaleString())} · ${items.length} SKU${items.length === 1 ? "" : "s"} · LeafLink inventory
  </div>
  <div class="filters">
    <h2>Current filters</h2>
    <ul>${filterHtml}</ul>
  </div>
  <table>
    <thead>
      <tr>
        <th>Product</th>
        <th>Brand</th>
        <th>SKU</th>
        <th>Strain</th>
        <th>Category</th>
        <th>Subcategory</th>
        <th>Qty</th>
        <th>Package</th>
        <th>Price</th>
        <th>Status</th>
        <th>Source package</th>
      </tr>
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
