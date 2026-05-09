export type MarketplaceOrderInvoiceSalesBlock = {
  primaryContactName: string;
  primaryContactEmail: string;
  primaryContactPhone: string;
  defaultPaymentTerms: string;
  fulfillmentNotes: string;
};

export type MarketplaceOrderInvoiceLine = {
  id: string;
  productNameSnapshot: string;
  skuSnapshot: string | null;
  unitSizeSnapshot: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type MarketplaceOrderInvoiceDto = {
  invoiceLabel: string;
  order: {
    id: string;
    status: string;
    subtotal: number;
    total: number;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
  };
  buyer: {
    id: string;
    name: string;
    slug: string;
    sales: MarketplaceOrderInvoiceSalesBlock | null;
  };
  seller: {
    id: string;
    name: string;
    slug: string;
    sales: MarketplaceOrderInvoiceSalesBlock | null;
  };
  lineItems: MarketplaceOrderInvoiceLine[];
  platformNotice: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtUsd(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function salesBlockHtml(title: string, sales: MarketplaceOrderInvoiceSalesBlock | null): string {
  if (!sales) {
    return `<div class="party-block"><h3>${escapeHtml(title)}</h3><p class="muted">No wholesale contact or terms saved in Admin → Company config (Sales).</p></div>`;
  }
  const lines: string[] = [];
  if (sales.primaryContactName) lines.push(`<div><strong>Contact</strong> ${escapeHtml(sales.primaryContactName)}</div>`);
  if (sales.primaryContactEmail) lines.push(`<div><strong>Email</strong> ${escapeHtml(sales.primaryContactEmail)}</div>`);
  if (sales.primaryContactPhone) lines.push(`<div><strong>Phone</strong> ${escapeHtml(sales.primaryContactPhone)}</div>`);
  if (sales.defaultPaymentTerms)
    lines.push(`<div class="terms"><strong>Payment terms</strong><br/>${escapeHtml(sales.defaultPaymentTerms).replace(/\n/g, "<br/>")}</div>`);
  if (sales.fulfillmentNotes)
    lines.push(`<div class="terms"><strong>Fulfillment / delivery notes</strong><br/>${escapeHtml(sales.fulfillmentNotes).replace(/\n/g, "<br/>")}</div>`);
  const inner = lines.length ? lines.join("") : `<p class="muted">No sales contact or terms on file.</p>`;
  return `<div class="party-block"><h3>${escapeHtml(title)}</h3>${inner}</div>`;
}

export function buildMarketplaceOrderInvoiceHtml(data: MarketplaceOrderInvoiceDto): string {
  const rows = data.lineItems
    .map(
      (it) =>
        `<tr>
          <td>${escapeHtml(it.productNameSnapshot)}${it.unitSizeSnapshot ? `<div class="muted small">${escapeHtml(it.unitSizeSnapshot)}</div>` : ""}</td>
          <td>${it.skuSnapshot ? escapeHtml(it.skuSnapshot) : "—"}</td>
          <td class="num">${Number(it.quantity)}</td>
          <td class="num">${fmtUsd(it.unitPrice)}</td>
          <td class="num">${fmtUsd(it.lineTotal)}</td>
        </tr>`,
    )
    .join("");

  const taxOrAdjust = Math.abs(data.order.total - data.order.subtotal) > 0.0001;
  const totalsExtra = taxOrAdjust
    ? `<tr><td colspan="4" class="num"><strong>Adjustments</strong></td><td class="num">${fmtUsd(data.order.total - data.order.subtotal)}</td></tr>`
    : "";

  const notesBlock = data.order.notes
    ? `<section class="section"><h3>Order notes</h3><p>${escapeHtml(data.order.notes).replace(/\n/g, "<br/>")}</p></section>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Invoice ${escapeHtml(data.invoiceLabel)} — NexBatch</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 32px; color: #0f172a; background: #fff; }
    h1 { margin: 0 0 8px; font-size: 26px; letter-spacing: -0.02em; }
    h2 { margin: 24px 0 8px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; }
    h3 { margin: 0 0 10px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: #475569; }
    .meta { color: #64748b; font-size: 14px; margin-bottom: 24px; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
    @media (max-width: 720px) { .grid2 { grid-template-columns: 1fr; } }
    .party-block { border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; font-size: 13px; line-height: 1.5; }
    .party-block div { margin-bottom: 6px; }
    .muted { color: #64748b; }
    .small { font-size: 12px; }
    .terms { margin-top: 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 10px 8px; text-align: left; vertical-align: top; }
    th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; background: #f8fafc; }
    td.num, th.num { text-align: right; }
    .totals { margin-top: 12px; width: 100%; max-width: 360px; margin-left: auto; font-size: 14px; }
    .totals tr td { border: none; padding: 6px 0; }
    .totals tr td:first-child { text-align: right; padding-right: 16px; color: #64748b; }
    .section { margin-top: 28px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 13px; line-height: 1.55; }
    .legal { margin-top: 24px; font-size: 11px; color: #64748b; line-height: 1.5; }
  </style>
</head>
<body>
  <header>
    <h1>Wholesale invoice</h1>
    <div class="meta">
      <div><strong>Invoice #</strong> ${escapeHtml(data.invoiceLabel)}</div>
      <div><strong>Order id</strong> ${escapeHtml(data.order.id)}</div>
      <div><strong>Status</strong> ${escapeHtml(data.order.status)}</div>
      <div><strong>Issued</strong> ${escapeHtml(fmtWhen(data.order.createdAt))}</div>
    </div>
  </header>

  <h2>Parties</h2>
  <div class="grid2">
    <div class="party-block">
      <h3>Bill to (buyer)</h3>
      <div><strong>${escapeHtml(data.buyer.name)}</strong></div>
      <div class="muted">Workspace slug: ${escapeHtml(data.buyer.slug)}</div>
    </div>
    <div class="party-block">
      <h3>Remit to (seller)</h3>
      <div><strong>${escapeHtml(data.seller.name)}</strong></div>
      <div class="muted">Workspace slug: ${escapeHtml(data.seller.slug)}</div>
    </div>
  </div>

  <h2>Contacts &amp; terms (from company config)</h2>
  <div class="grid2">
    ${salesBlockHtml("Buyer — wholesale profile", data.buyer.sales)}
    ${salesBlockHtml("Seller — wholesale profile", data.seller.sales)}
  </div>

  <h2>Line items</h2>
  <table>
    <thead>
      <tr>
        <th>Product</th>
        <th>SKU</th>
        <th class="num">Qty</th>
        <th class="num">Unit price</th>
        <th class="num">Line total</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  <table class="totals">
    <tr><td>Subtotal</td><td>${fmtUsd(data.order.subtotal)}</td></tr>
    ${totalsExtra}
    <tr><td><strong>Total due</strong></td><td><strong>${fmtUsd(data.order.total)}</strong></td></tr>
  </table>

  ${notesBlock}

  <section class="section legal">
    <strong>Notice.</strong> ${escapeHtml(data.platformNotice)}
  </section>
</body>
</html>`;
}

export function printMarketplaceOrderInvoice(data: MarketplaceOrderInvoiceDto): void {
  const html = buildMarketplaceOrderInvoiceHtml(data);
  const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=1200");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  window.setTimeout(() => {
    try {
      w.print();
    } catch {
      /* ignore */
    }
  }, 250);
}

export function downloadMarketplaceOrderInvoiceHtml(data: MarketplaceOrderInvoiceDto): void {
  const html = buildMarketplaceOrderInvoiceHtml(data);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nexbatch-invoice-${data.invoiceLabel.replace(/[^a-zA-Z0-9-_]/g, "")}.html`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
