import { AppError } from "../errors/AppError.js";
import { logInfo, logWarn } from "../lib/logger.js";
import {
  fetchJsonWithRetry,
  pickListSource,
  LeafLinkService,
  type LeafLinkRuntimeCredentials,
} from "./leaflinkService.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function cleanString(v: unknown): string {
  return String(v ?? "").trim();
}

/** Only full UUIDs are “bad” display values — 8-char hex is often LeafLink’s human order # (e.g. d83a9509). */
function looksLikeFullUuid(v: string): boolean {
  const s = cleanString(v).toLowerCase();
  if (!s) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s);
}

function toNumber(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function moneyAmount(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "object" && !Array.isArray(v)) {
    const o = asRecord(v);
    const a = o.amount;
    if (typeof a === "number" && Number.isFinite(a)) return a;
    if (typeof a === "string") {
      const n = Number.parseFloat(a);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

/** Standardized wholesale order — detail + summary. */
export type LeafLinkOrderLineItemDto = {
  id: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPrice: number | null;
  lineTotal: number | null;
  notes: string;
  productId: string;
};

export type LeafLinkOrderSummaryDto = {
  id: string;
  orderNumber: string;
  /** LeafLink seller-facing short reference when present. */
  shortNumber: string;
  customerName: string;
  status: string;
  statusNormalized: string;
  createdAt: string;
  updatedAt: string;
  subtotal: number | null;
  total: number | null;
  itemCount: number;
  salesRep: string;
  paymentStatus: string;
  deliveryDate: string | null;
  lineItems: LeafLinkOrderLineItemDto[];
  notes: string;
  internalNotes: string | null;
  discount: number | null;
  discountType: string | null;
  taxAmount: number | null;
  finalTaxAmount: number | null;
  shippingAmount: number | null;
  paymentTerm: string | null;
  paid: boolean;
  shipDate: string | null;
  deliveryPreferences: string | null;
  shippingDetails: string | null;
  classification: string;
  buyerCustomerId: string;
};

export type LeafLinkOrderCardDto = Omit<LeafLinkOrderSummaryDto, "lineItems"> & {
  itemCount: number;
};

export type LeafLinkOrdersListDto = {
  source: "leaflink";
  configured: boolean;
  integrationEnabled: boolean;
  orders: LeafLinkOrderCardDto[];
  totalCount: number;
  page: number;
  pageSize: number;
  ordering: string;
  hasNext: boolean;
  hasPrevious: boolean;
  lastFetchedAt: string;
  fromCache?: boolean;
};

export type LeafLinkOrdersSyncDto = {
  ok: boolean;
  configured: boolean;
  integrationEnabled: boolean;
  pagesPulled: number;
  ordersSeen: number;
  lastFetchedAt: string;
};

export type OrdersAnalyticsSampleTypeBreakdown = {
  typeLabel: string;
  /** Units = sum of line quantities for that product label. */
  units: number;
};

export type OrdersAnalyticsCustomerDto = {
  key: string;
  label: string;
  /** Latest qualifying order date in range (ISO 8601). */
  lastPurchaseDate: string;
  /** Sum of qualifying order totals in range. */
  orderTotalInRange: number;
  /** Sample line units in range (see sample detection heuristic). */
  sampleUnitsInRange: number;
  samplesByType: OrdersAnalyticsSampleTypeBreakdown[];
  /** Parallel to {@link OrdersAnalyticsDto.days}. */
  revenueByDay: number[];
  orderCountByDay: number[];
  sampleUnitsByDay: number[];
};

export type OrdersAnalyticsDto = {
  source: "leaflink";
  configured: boolean;
  integrationEnabled: boolean;
  dateFrom: string;
  dateTo: string;
  /** Qualifying orders: in range, not cancelled, total ≥ minOrderTotal. */
  ordersIncluded: number;
  minOrderTotal: number;
  pagesScanned: number;
  truncated: boolean;
  days: string[];
  /** Customers with at least one qualifying order (active for this report). */
  customers: OrdersAnalyticsCustomerDto[];
};

const MAX_ANALYTICS_RANGE_DAYS = 366;
const MAX_ANALYTICS_PAGES = 50;
/** Only orders at or above this total count toward analytics and customer inclusion. */
export const ORDERS_ANALYTICS_MIN_ORDER_TOTAL = 50;

function utcDayKeyFromMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseUtcDateOnlyToMs(isoDate: string, endOfDay: boolean): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) return NaN;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (endOfDay)
    return Date.UTC(y, mo, d, 23, 59, 59, 999);
  return Date.UTC(y, mo, d, 0, 0, 0, 0);
}

function enumerateUtcDaysInclusive(fromStr: string, toStr: string): string[] {
  const fromMs = parseUtcDateOnlyToMs(fromStr, false);
  const toMs = parseUtcDateOnlyToMs(toStr, true);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs)
    return [];
  const out: string[] = [];
  let cursor = fromMs;
  const dayMs = 86_400_000;
  while (cursor <= toMs) {
    out.push(utcDayKeyFromMs(cursor));
    cursor += dayMs;
  }
  return out;
}

function customerSeriesKey(id: string, name: string): string {
  const base = cleanString(id) || cleanString(name).slice(0, 40) || "unknown";
  return `c_${base.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80)}`;
}

function orderTotalMoney(o: LeafLinkOrderSummaryDto): number {
  if (typeof o.total === "number" && Number.isFinite(o.total)) return o.total;
  if (typeof o.subtotal === "number" && Number.isFinite(o.subtotal)) return o.subtotal;
  const sum = o.lineItems.reduce((acc, li) => acc + (li.lineTotal ?? 0), 0);
  return Number.isFinite(sum) ? sum : 0;
}

function isCancelledOrder(o: LeafLinkOrderSummaryDto): boolean {
  return o.statusNormalized === "Cancelled";
}

/** Heuristic: product/SKU/notes contain “sample” (wholesale freebies are often labeled explicitly). */
function isSampleLineItem(li: LeafLinkOrderLineItemDto): boolean {
  const name = cleanString(li.productName).toLowerCase();
  const sku = cleanString(li.sku).toLowerCase();
  const notes = cleanString(li.notes).toLowerCase();
  if (/\bsample\b/.test(name)) return true;
  if (/\bsample\b/.test(sku) || /\bsmpl\b/.test(sku)) return true;
  if (notes.includes("sample")) return true;
  return false;
}

function sampleTypeLabelForLine(li: LeafLinkOrderLineItemDto): string {
  const name = cleanString(li.productName);
  if (name) return name.length > 120 ? `${name.slice(0, 117)}…` : name;
  const s = cleanString(li.sku);
  if (s) return s;
  return "Sample";
}

/** Snapshot fields LeafLink stores on line items at order time (often has real product labels when `product` is only an id). */
function hintsFromFrozenData(r: Record<string, unknown>): { name: string; sku: string } {
  const fr = r.frozen_data;
  if (fr == null || typeof fr !== "object" || Array.isArray(fr))
    return { name: "", sku: "" };
  const f = asRecord(fr);
  let name = cleanString(
    f.display_name
    || f.product_display_name
    || f.product_name
    || f.name
    || f.title
    || f.listing_name,
  );
  let sku = cleanString(f.sku || f.product_sku);
  const nested = f.product;
  if (nested != null && typeof nested === "object" && !Array.isArray(nested)) {
    const p = asRecord(nested);
    if (!name)
      name = cleanString(p.display_name || p.name || p.product_name || p.title);
    if (!sku)
      sku = cleanString(p.sku || p.product_sku);
  }
  return { name, sku };
}

function isPlaceholderProductLabel(name: string): boolean {
  const n = cleanString(name);
  if (!n) return true;
  return /^product\s+\d+$/i.test(n);
}

function countResolvedLineProductNames(items: LeafLinkOrderLineItemDto[]): number {
  return items.filter((li) => !isPlaceholderProductLabel(li.productName)).length;
}

function mergeLineItemsPreferRicher(
  embedded: LeafLinkOrderLineItemDto[],
  fromApi: LeafLinkOrderLineItemDto[],
): LeafLinkOrderLineItemDto[] {
  const byId = new Map(fromApi.map((li) => [li.id, li]));
  return embedded.map((e) => {
    const a = byId.get(e.id);
    if (!a) return e;
    const eBad = isPlaceholderProductLabel(e.productName);
    const aGood = !isPlaceholderProductLabel(a.productName);
    if (aGood && eBad) {
      return {
        ...e,
        productName: a.productName,
        sku: cleanString(a.sku) || e.sku,
      };
    }
    if (!cleanString(e.sku) && cleanString(a.sku))
      return { ...e, sku: a.sku };
    return e;
  });
}

async function fetchOrderLineItemsRaw(
  creds: LeafLinkRuntimeCredentials,
  baseRaw: string,
  orderApiKey: string,
): Promise<unknown[]> {
  const base = baseRaw.replace(/\/+$/, "");
  const enc = encodeURIComponent(orderApiKey.trim());
  const qs = new URLSearchParams({ page_size: "500", page: "1" }).toString();
  const urls: string[] = [];
  if (creds.companyId) {
    urls.push(
      `${base}/v2/companies/${encodeURIComponent(creds.companyId)}/orders-received/${enc}/line-items/?${qs}`,
    );
  }
  urls.push(`${base}/v2/orders-received/${enc}/line-items/?${qs}`);
  const { body } = await leafLinkAuthedGet(urls, creds, 30_000);
  if (Array.isArray(body)) return body;
  const root = asRecord(body);
  if (Array.isArray(root.results)) return root.results;
  const { list } = pickListSource(body);
  return list;
}

function buildProductDetailUrlCandidates(
  baseRaw: string,
  creds: LeafLinkRuntimeCredentials,
  productId: string,
): string[] {
  const base = baseRaw.replace(/\/+$/, "");
  const id = encodeURIComponent(productId.trim());
  const cands: string[] = [];
  if (creds.companyId) {
    cands.push(`${base}/v2/companies/${encodeURIComponent(creds.companyId)}/products/${id}/`);
  }
  cands.push(`${base}/v2/products/${id}/`, `${base}/products/${id}/`);
  const seen = new Set<string>();
  return cands.filter((u) => {
    if (!u || seen.has(u)) return false;
    seen.add(u);
    return true;
  });
}

function lineItemNeedsProductHydration(li: LeafLinkOrderLineItemDto): boolean {
  if (!cleanString(li.productId)) return false;
  if (isPlaceholderProductLabel(li.productName)) return true;
  if (!cleanString(li.sku)) return true;
  return false;
}

async function hydrateLineItemsViaProductDetails(
  creds: LeafLinkRuntimeCredentials,
  baseRaw: string,
  items: LeafLinkOrderLineItemDto[],
): Promise<LeafLinkOrderLineItemDto[]> {
  const ids = [...new Set(items.filter(lineItemNeedsProductHydration).map((li) => li.productId))];
  const cap = 40;
  const cache = new Map<string, { name: string; sku: string }>();
  for (const pid of ids.slice(0, cap)) {
    if (!pid || cache.has(pid)) continue;
    try {
      const urls = buildProductDetailUrlCandidates(baseRaw, creds, pid);
      const { body } = await leafLinkAuthedGet(urls, creds, 12_000);
      if (body && typeof body === "object" && !Array.isArray(body)) {
        const p = asRecord(body);
        cache.set(pid, {
          name: cleanString(p.display_name || p.name || p.product_name),
          sku: cleanString(p.sku),
        });
      }
    }
    catch {
      logWarn("[LEAFLINK] orders_product_hydrate_skip", { productId: pid });
    }
  }
  return items.map((li) => {
    const pid = li.productId;
    if (!pid || !lineItemNeedsProductHydration(li)) return li;
    const hit = cache.get(pid);
    if (!hit) return li;
    return {
      ...li,
      productName: !isPlaceholderProductLabel(hit.name) ? hit.name : li.productName,
      sku: cleanString(hit.sku) || li.sku,
    };
  });
}

async function enrichDetailLineItems(
  creds: LeafLinkRuntimeCredentials,
  baseRaw: string,
  orderRow: Record<string, unknown>,
  embedded: LeafLinkOrderLineItemDto[],
): Promise<LeafLinkOrderLineItemDto[]> {
  const orderApiKey = cleanString(
    orderRow.number
    || orderRow.order_number
    || orderRow.id
    || orderRow.order_id,
  );
  if (!orderApiKey)
    return hydrateLineItemsViaProductDetails(creds, baseRaw, embedded);

  let items = embedded;
  try {
    const rawLines = await fetchOrderLineItemsRaw(creds, baseRaw, orderApiKey);
    if (rawLines.length > 0) {
      const fromDedicated = extractLineItems({ line_items: rawLines });
      const embeddedScore = countResolvedLineProductNames(embedded);
      const apiScore = countResolvedLineProductNames(fromDedicated);
      if (fromDedicated.length >= embedded.length && apiScore >= embeddedScore)
        items = fromDedicated;
      else if (apiScore > embeddedScore)
        items = mergeLineItemsPreferRicher(embedded, fromDedicated);
      else if (fromDedicated.length > embedded.length)
        items = fromDedicated;
    }
  }
  catch (err) {
    logWarn("[LEAFLINK] orders_line_items_extra_fetch_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return hydrateLineItemsViaProductDetails(creds, baseRaw, items);
}

function extractLineItems(raw: Record<string, unknown>): LeafLinkOrderLineItemDto[] {
  const arr = raw.line_items;
  if (!Array.isArray(arr)) return [];
  const out: LeafLinkOrderLineItemDto[] = [];
  for (let i = 0; i < arr.length; i++) {
    const li = arr[i];
    const r = asRecord(li);
    const frozenHints = hintsFromFrozenData(r);
    const prodRaw = r.product;
    let productName = "";
    let sku = "";
    let productId = "";
    if (prodRaw != null && typeof prodRaw === "object" && !Array.isArray(prodRaw)) {
      const p = asRecord(prodRaw);
      productName = cleanString(p.name || p.product_name || p.title || p.display_name);
      sku = cleanString(p.sku || p.product_sku);
      productId = cleanString(p.id);
    }
    else {
      productId = cleanString(prodRaw);
    }
    if (!productName) {
      const listing =
        r.listing != null && typeof r.listing === "object" && !Array.isArray(r.listing)
          ? asRecord(r.listing)
          : {};
      const inv =
        r.inventory_item != null && typeof r.inventory_item === "object" && !Array.isArray(r.inventory_item)
          ? asRecord(r.inventory_item)
          : {};
      productName = cleanString(
        r.product_name
        || r.name
        || r.title
        || r.item_name
        || r.inventory_name
        || r.listing_name
        || r.display_name
        || listing.name
        || listing.title
        || listing.product_name
        || inv.name
        || inv.product_name
        || inv.sku,
      );
    }
    if (!sku) {
      sku = cleanString(r.sku || r.product_sku || r.item_sku || r.inventory_sku);
    }
    if (!productName && frozenHints.name)
      productName = frozenHints.name;
    if (!sku && frozenHints.sku)
      sku = frozenHints.sku;
    const qty = toNumber(r.quantity);
    const unitPrice = moneyAmount(r.ordered_unit_price) ?? moneyAmount(r.sale_price) ?? moneyAmount(r.wholesale_price);
    let lineTotal: number | null = null;
    if (typeof r.total === "number" && Number.isFinite(r.total)) lineTotal = r.total;
    else if (unitPrice != null && qty > 0) lineTotal = unitPrice * qty;
    out.push({
      id: cleanString(r.id) || `line-${i}`,
      productName: productName || `Product ${productId || `#${i + 1}`}`,
      sku,
      quantity: qty,
      unitPrice,
      lineTotal,
      notes: cleanString(r.notes),
      productId,
    });
  }
  return out;
}

function normalizeStatusLabel(raw: string): string {
  const s = cleanString(raw).toLowerCase();
  const map: Record<string, string> = {
    draft: "Draft",
    submitted: "Submitted",
    accepted: "Approved",
    backorder: "Submitted",
    fulfilled: "Fulfilled",
    shipped: "Shipped",
    complete: "Delivered",
    cancelled: "Cancelled",
    canceled: "Cancelled",
    rejected: "Cancelled",
    combined: "Submitted",
  };
  return map[s] || (raw ? raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Unknown");
}

function normalizeOrder(raw: unknown): LeafLinkOrderSummaryDto {
  const row = asRecord(raw);
  const customer = row.customer != null && typeof row.customer === "object" && !Array.isArray(row.customer)
    ? asRecord(row.customer)
    : {};
  /** API lookup key (stable internal id when present). */
  const lookupId = cleanString(row.id || row.order_id || row.number || row.order_number);
  const nestedOrder = row.order != null && typeof row.order === "object" && !Array.isArray(row.order)
    ? asRecord(row.order)
    : {};
  /**
   * Human-facing “Order No.” per LeafLink docs:
   * - `order_seller_number` aliases `external_id_seller` (seller-assigned ref like d83a9509); if missing, falls back to `short_id`.
   * - `order_short_number` aliases `short_id` only (8-char tail of UUID) — do NOT prefer over seller number.
   */
  const displayCandidates = [
    row.external_id_seller,
    row.order_seller_number,
    row.seller_order_number,
    row.display_number,
    row.human_readable_id,
    row.reference_number,
    row.order_reference,
    row.retailer_order_number,
    row.external_order_number,
    row.invoice_number,
    row.order_code,
    row.confirmation_number,
    nestedOrder.number,
    nestedOrder.order_number,
    nestedOrder.display_number,
    nestedOrder.human_readable_id,
    row.number,
    row.order_number,
    row.order_short_number,
    row.short_id,
    nestedOrder.short_id,
    row.external_id,
    row.code,
    row.name,
    row.po_number,
  ].map(cleanString).filter(Boolean);
  const displayPreferred =
    displayCandidates.find((c) => !looksLikeFullUuid(c)) || displayCandidates[0];
  const displayOrderNumber = cleanString(displayPreferred || lookupId);

  let salesRep = "";
  const sr = row.sales_reps;
  if (Array.isArray(sr) && sr.length > 0) {
    const first = asRecord(sr[0]);
    salesRep = cleanString(first.user || first.username || first.name);
  }

  const lineItems = extractLineItems(row);
  let subtotal: number | null = moneyAmount(row.subtotal);
  if (subtotal == null && lineItems.length) {
    const sum = lineItems.reduce((acc, x) => acc + (x.lineTotal ?? 0), 0);
    subtotal = sum > 0 ? sum : null;
  }

  const total = moneyAmount(row.total);
  const taxAmount = typeof row.tax_amount === "number" ? row.tax_amount : moneyAmount(row.tax_amount);
  const finalTaxAmt = moneyAmount(row.final_tax);
  const ship = row.shipping_charge;
  const shippingAmount = typeof ship === "number" ? ship : moneyAmount(ship);
  const paid = Boolean(row.paid);
  const statusRaw = cleanString(row.status) || "unknown";

  let deliveryDate: string | null = cleanString(row.ship_date || row.delivery_date);
  const dInfo = row.delivery_info;
  if (!deliveryDate && dInfo != null && typeof dInfo === "object" && !Array.isArray(dInfo)) {
    deliveryDate =
      cleanString(asRecord(dInfo).delivery_date) ||
      cleanString(asRecord(dInfo).estimated_delivery_date) ||
      cleanString(asRecord(dInfo).arrival_date) ||
      null;
  }

  const shortNumber =
    cleanString(
      row.external_id_seller
      || row.order_seller_number
      || row.order_short_number
      || row.short_id,
    ) || displayOrderNumber.slice(0, 12);

  return {
    id: lookupId || displayOrderNumber,
    orderNumber: displayOrderNumber || shortNumber,
    shortNumber,
    customerName: cleanString(customer.display_name || customer.name || customer.company_name || row.buyer_company),
    status: statusRaw,
    statusNormalized: normalizeStatusLabel(statusRaw),
    createdAt: cleanString(row.created_on || row.created_at || ""),
    updatedAt: cleanString(row.modified || row.updated_at || row.modified_at || ""),
    subtotal,
    total,
    itemCount: lineItems.length,
    salesRep,
    paymentStatus: paid ? "Paid" : "Unpaid",
    deliveryDate,
    lineItems,
    notes: cleanString(row.notes),
    internalNotes: cleanString(row.internal_notes) || null,
    discount: typeof row.discount === "number" ? row.discount : toNumber(row.discount),
    discountType: cleanString(row.discount_type) || null,
    taxAmount,
    finalTaxAmount: finalTaxAmt,
    shippingAmount,
    paymentTerm: cleanString(row.payment_term) || null,
    paid,
    shipDate: cleanString(row.ship_date) || null,
    deliveryPreferences: cleanString(row.delivery_preferences) || null,
    shippingDetails: cleanString(row.shipping_details) || null,
    classification: cleanString(row.classification),
    buyerCustomerId: cleanString(customer.id ?? row.buyer),
  };
}

export function orderToCardDto(o: LeafLinkOrderSummaryDto): LeafLinkOrderCardDto {
  const { lineItems, ...rest } = o;
  return { ...rest, itemCount: lineItems.length };
}

function leafLinkHeaders(creds: LeafLinkRuntimeCredentials, authValue: string): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: authValue,
    "X-API-KEY": creds.apiKey,
    "x-api-key": creds.apiKey,
    "X-Company-Slug": creds.companySlug,
    "X-LeafLink-Company-Id": creds.companyId,
    "X-LeafLink-Username": creds.username,
  };
}

async function leafLinkAuthedGet(
  urls: string[],
  creds: LeafLinkRuntimeCredentials,
  timeoutMs: number,
): Promise<{ url: string; authMode: string; body: unknown }> {
  const basicAuth = creds.username ? Buffer.from(`${creds.username}:${creds.apiKey}`, "utf8").toString("base64") : "";
  const authCandidates = [
    `App ${creds.apiKey}`,
    `Token ${creds.apiKey}`,
    `Bearer ${creds.apiKey}`,
    ...(basicAuth ? [`Basic ${basicAuth}`] : []),
  ];
  let lastErr: unknown;
  for (const url of urls) {
    if (!url) continue;
    for (const authValue of authCandidates) {
      const authMode = authValue.startsWith("App ")
        ? "App"
        : authValue.startsWith("Token ")
          ? "Token"
          : authValue.startsWith("Bearer ")
            ? "Bearer"
            : "Basic";
      const init: RequestInit = {
        method: "GET",
        headers: leafLinkHeaders(creds, authValue),
      };
      try {
        logInfo("[LEAFLINK] orders_request", { url: url.slice(0, 200), authMode });
        const body = await fetchJsonWithRetry(url, init, timeoutMs);
        return { url, authMode, body };
      }
      catch (err) {
        lastErr = err;
        const code = err instanceof AppError ? err.code : "";
        if (
          code === "LEAFLINK_INVALID_CREDENTIALS"
          || code === "LEAFLINK_REQUEST_FAILED"
          || code === "LEAFLINK_HTML_ERROR"
          || code === "LEAFLINK_NON_JSON_RESPONSE"
          || code === "LEAFLINK_TEMPORARY"
        ) {
          logWarn("[LEAFLINK] orders_try_fallback", {
            url: url.slice(0, 160),
            err: err instanceof Error ? err.message : String(err),
          });
          continue;
        }
        throw err;
      }
    }
  }
  if (lastErr instanceof AppError) throw lastErr;
  throw lastErr instanceof Error ? lastErr : new AppError("LeafLink orders request failed.", 502, "LEAFLINK_ORDERS_FAILED");
}

function buildOrdersListUrlCandidates(
  base: string,
  creds: LeafLinkRuntimeCredentials,
  searchParams: URLSearchParams,
): string[] {
  const merged = new URLSearchParams(searchParams.toString());
  merged.set("fields_add", "line_items,customer,sales_reps");
  const root = base.replace(/\/+$/, "");
  const candidates: string[] = [];

  if (creds.companyId) {
    candidates.push(
      `${root}/v2/companies/${encodeURIComponent(creds.companyId)}/orders-received/?${merged.toString()}`,
    );
  }
  if (creds.companySlug) {
    const u = new URL(`${root}/v2/orders-received/`);
    merged.forEach((v, k) => u.searchParams.set(k, v));
    u.searchParams.set("seller__slug__iexact", creds.companySlug);
    u.searchParams.set("fields_add", "line_items,customer,sales_reps");
    candidates.push(u.href);
  }
  {
    const u = new URL(`${root}/v2/orders-received/`);
    merged.forEach((v, k) => u.searchParams.set(k, v));
    u.searchParams.set("fields_add", "line_items,customer,sales_reps");
    candidates.push(u.href);
  }

  const seen = new Set<string>();
  return candidates.filter((href) => {
    if (!href || seen.has(href)) return false;
    seen.add(href);
    return true;
  });
}

function parseListBody(body: unknown): { list: unknown[]; totalCount: number; next: string | null; previous: string | null } {
  const root = asRecord(body);
  let totalCount = 0;
  if (typeof root.count === "number" && Number.isFinite(root.count) && root.count >= 0)
    totalCount = root.count;
  const meta = typeof root.meta === "object" && root.meta !== null ? asRecord(root.meta) : null;
  if (totalCount === 0 && meta && typeof meta.count === "number")
    totalCount = meta.count;

  const { list } = pickListSource(body);
  if (totalCount === 0 && Array.isArray(list))
    totalCount = list.length;

  const next = typeof root.next === "string" && root.next.trim()
    ? String(root.next).trim()
    : null;
  const previous =
    typeof root.previous === "string" && root.previous.trim()
      ? String(root.previous).trim()
      : null;
  return { list, totalCount, next, previous };
}

/** Light in-process cache for identical list reads (TTL). */
const LIST_CACHE_TTL_MS = 45_000;
const listCaches = new Map<string, { at: number; payload: LeafLinkOrdersListDto }>();

function cacheKey(parts: Record<string, string | number | boolean | undefined>): string {
  return JSON.stringify(parts);
}

function clearTenantOrderCachePrefix(companyId: string): void {
  const prefix = `"companyId":"${companyId}"`;
  for (const k of [...listCaches.keys()]) {
    if (k.includes(prefix))
      listCaches.delete(k);
  }
}

export class LeafLinkOrdersService {
  leafLinkService = new LeafLinkService();

  async assertOrdersCapableOrThrow(creds: LeafLinkRuntimeCredentials): Promise<void> {
    if (!creds.apiKey || (!creds.companyId && !creds.companySlug)) {
      throw new AppError(
        "LeafLink is not fully configured. Set company ID or company slug, plus API key, in Company Admin → Inventory / LeafLink.",
        400,
        "LEAFLINK_MISSING_CONFIG",
      );
    }
  }

  async listOrders(
    companyId: string,
    input: {
      page: number;
      pageSize: number;
      status?: string;
      ordering?: string;
      refresh?: boolean;
      /** Client-side-ish filter over merged pages when non-empty (avoids bogus pagination over one partial page). */
      search?: string;
    },
  ): Promise<LeafLinkOrdersListDto> {
    const creds = await this.leafLinkService.resolveRuntimeCredentials(companyId);

    const nowIso = new Date().toISOString();
    const baseOut: Omit<LeafLinkOrdersListDto, "orders" | "totalCount" | "hasNext" | "hasPrevious" | "lastFetchedAt" | "fromCache"> = {
      source: "leaflink",
      configured: Boolean(creds.apiKey && (creds.companyId || creds.companySlug)),
      integrationEnabled: creds.integrationEnabled,
      page: input.page,
      pageSize: input.pageSize,
      ordering: input.ordering || "-created_on",
    };

    if (!baseOut.configured || !creds.integrationEnabled) {
      return {
        ...baseOut,
        orders: [],
        totalCount: 0,
        hasNext: false,
        hasPrevious: false,
        lastFetchedAt: nowIso,
      };
    }

    await this.assertOrdersCapableOrThrow(creds);

    const base = creds.baseUrl.replace(/\/+$/, "");
    const ordering = cleanString(input.ordering) || "-created_on";
    const needleRaw = cleanString(input.search).toLowerCase();
    /** Multi-page merge is expensive; skip for empty or accidental single-char pings. */
    const needle = needleRaw.length >= 2 ? needleRaw : "";

    const searchParams = new URLSearchParams();
    searchParams.set("page", String(Math.max(1, input.page)));
    searchParams.set("page_size", String(Math.min(500, Math.max(1, input.pageSize))));
    searchParams.set("ordering", ordering);
    const statusFilter = cleanString(input.status);
    if (statusFilter && statusFilter !== "all") {
      const leafStatus = statusFilter.toLowerCase();
      searchParams.set("status", leafStatus);
    }
    if (needleRaw && needleRaw.length >= 2)
      searchParams.set("search", cleanString(input.search));

    /** Broader catalogue pull when scanning for text matches across recent orders (LeafLink ignores `search` on many tenants). */
    if (needle) {
      searchParams.set("page_size", "100");

      let dedupedCards: LeafLinkOrderCardDto[] = [];
      const seen = new Set<string>();
      const pageNumReq = Math.max(1, input.page);
      const psSlice = Math.min(500, Math.max(1, input.pageSize));
      /** Cap upstream calls — wholesale order volume stays bounded for most sellers. */
      const maxPagesPull = 12;

      for (let pg = 1; pg <= maxPagesPull; pg++) {
        searchParams.set("page", String(pg));
        const urls = buildOrdersListUrlCandidates(base, creds, searchParams);

        let body: unknown;
        let authMode = "";
        try {
          const got = await leafLinkAuthedGet(urls, creds, 25_000);
          authMode = got.authMode;
          body = got.body;
        }
        catch (err) {
          logWarn("[LEAFLINK] orders_search_pull_failed", {
            companyId,
            pageInPull: pg,
            err: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }

        const { list } = parseListBody(body);

        logInfo("[LEAFLINK] orders_search_pull_page", {
          authMode,
          pageInPull: pg,
          rowCount: Array.isArray(list) ? list.length : 0,
        });

        for (const raw of list) {
          const card = orderToCardDto(normalizeOrder(raw));
          const k = `${card.orderNumber}:${card.buyerCustomerId}`;
          if (seen.has(k)) continue;
          seen.add(k);

          const on = card.orderNumber.toLowerCase();
          const cn = card.customerName.toLowerCase();
          if (!on.includes(needle) && !cn.includes(needle))
            continue;
          dedupedCards.push(card);
        }

        const rootNext = asRecord(body).next;
        const hasLeafNext = typeof rootNext === "string" && rootNext.trim().length > 0;
        /** Stop when API has no cursor and last page shorter than requested size — typical end of list. */
        const shortPage = Array.isArray(list) && list.length > 0 && list.length < 100;
        if (!hasLeafNext && shortPage) break;
        if (!Array.isArray(list) || list.length === 0) break;
      }

      const sorted = [...dedupedCards].sort((a, b) => {
        const ta = Date.parse(a.createdAt || "") || 0;
        const tb = Date.parse(b.createdAt || "") || 0;
        return ordering.startsWith("-") ? tb - ta : ta - tb;
      });

      const totalFiltered = sorted.length;
      const start = (pageNumReq - 1) * psSlice;
      const pageSlice = sorted.slice(start, start + psSlice);

      const payloadNeedle: LeafLinkOrdersListDto = {
        ...baseOut,
        ordering,
        orders: pageSlice,
        totalCount: totalFiltered,
        page: pageNumReq,
        pageSize: psSlice,
        hasNext: start + psSlice < totalFiltered,
        hasPrevious: pageNumReq > 1,
        lastFetchedAt: nowIso,
        fromCache: false,
      };

      logInfo("[LEAFLINK] orders_search_done", {
        totalMatched: totalFiltered,
        pageReturned: pageSlice.length,
        companyId,
      });

      return payloadNeedle;
    }

    const ck = cacheKey({
      companyId,
      ...Object.fromEntries(searchParams.entries()),
    });
    if (!input.refresh) {
      const hit = listCaches.get(ck);
      if (hit && Date.now() - hit.at < LIST_CACHE_TTL_MS) {
        return { ...hit.payload, fromCache: true };
      }
    }

    const urls = buildOrdersListUrlCandidates(base, creds, searchParams);

    const { authMode, body } = await leafLinkAuthedGet(urls, creds, 20_000);
    logInfo("[LEAFLINK] orders_list_ok", { authMode, page: input.page });

    const { list, totalCount: apiTotal, next } = parseListBody(body);

    /** If API exposes no aggregate count but `next` exists, approximate hasNext without total. */
    const orders = list.map((r) => orderToCardDto(normalizeOrder(r)));
    const rawRoot = asRecord(body);
    const nextUrl = typeof next === "string" ? next.trim() : "";

    let totalCount = apiTotal || orders.length;
    const ps = Number(searchParams.get("page_size")) || orders.length || 18;
    const pageNum = Number(searchParams.get("page")) || 1;
    const hasNextBool =
      Boolean(nextUrl) || (apiTotal ? pageNum * ps < apiTotal : false);
    const hasPrevBool = pageNum > 1;

    if (!apiTotal && hasNextBool)
      totalCount = pageNum * ps + orders.length;

    const payload: LeafLinkOrdersListDto = {
      ...baseOut,
      ordering,
      orders,
      totalCount,
      hasNext: hasNextBool,
      hasPrevious: hasPrevBool,
      lastFetchedAt: nowIso,
    };
    listCaches.set(ck, {
      at: Date.now(),
      payload: {
        ...payload,
        lastFetchedAt: nowIso,
        fromCache: false,
      },
    });

    logInfo("[LEAFLINK] orders_list_normalized", {
      count: orders.length,
      apiTotal,
      rawCount: typeof rawRoot.count === "number" ? rawRoot.count : undefined,
      hasNextUrl: Boolean(nextUrl),
      authMode,
    });
    return payload;
  }

  async getOrder(companyId: string, orderId: string): Promise<LeafLinkOrderSummaryDto | null> {
    const creds = await this.leafLinkService.resolveRuntimeCredentials(companyId);
    if (!creds.integrationEnabled || !creds.apiKey || (!creds.companyId && !creds.companySlug))
      throw new AppError("LeafLink is not configured.", 400, "LEAFLINK_MISSING_CONFIG");
    await this.assertOrdersCapableOrThrow(creds);

    const id = encodeURIComponent(orderId.trim());
    const detailQs = new URLSearchParams({
      fields_add: "line_items,customer,sales_reps",
    }).toString();
    const base = creds.baseUrl.replace(/\/+$/, "");
    const urls: string[] = [];
    if (creds.companyId) {
      urls.push(
        `${base}/v2/companies/${encodeURIComponent(creds.companyId)}/orders-received/${id}/?${detailQs}`,
      );
    }
    urls.push(`${base}/v2/orders-received/${id}/?${detailQs}`);
    const { authMode, body } = await leafLinkAuthedGet(urls, creds, 25_000);
    logInfo("[LEAFLINK] orders_detail_ok", { authMode });
    const row = typeof body === "object" && body !== null && !Array.isArray(body) ? body : null;
    if (!row) return null;

    /** Single-object detail may omit results wrapper */
    const r = row as Record<string, unknown>;
    if (!cleanString(r.id || r.order_id || r.number || r.order_number || r.short_id || r.order_short_number))
      return null;

    const summary = normalizeOrder(body);
    const lineItems = await enrichDetailLineItems(creds, base, r, summary.lineItems);
    return {
      ...summary,
      lineItems,
      itemCount: lineItems.length,
    };
  }

  /**
   * One page of order summaries including embedded line items (`fields_add=line_items` on list API).
   * Does not use the short list cache (callers control freshness).
   */
  async listOrdersSummaries(
    companyId: string,
    input: {
      page: number;
      pageSize: number;
      ordering?: string;
    },
  ): Promise<{ summaries: LeafLinkOrderSummaryDto[]; hasNext: boolean }> {
    const creds = await this.leafLinkService.resolveRuntimeCredentials(companyId);
    if (!creds.integrationEnabled || !baseOutConfiguredForOrders(creds))
      return { summaries: [], hasNext: false };

    await this.assertOrdersCapableOrThrow(creds);
    const base = creds.baseUrl.replace(/\/+$/, "");
    const ordering = cleanString(input.ordering) || "-created_on";
    const searchParams = new URLSearchParams();
    searchParams.set("page", String(Math.max(1, input.page)));
    searchParams.set("page_size", String(Math.min(500, Math.max(1, input.pageSize))));
    searchParams.set("ordering", ordering);
    const urls = buildOrdersListUrlCandidates(base, creds, searchParams);
    const { body } = await leafLinkAuthedGet(urls, creds, 20_000);
    const { list, totalCount: apiTotal, next } = parseListBody(body);
    const summaries = list.map((r) => normalizeOrder(r));
    const pageNum = Math.max(1, input.page);
    const ps = Math.min(500, Math.max(1, input.pageSize));
    const nextUrl = typeof next === "string" ? next.trim() : "";
    const hasNextBool =
      Boolean(nextUrl) || (apiTotal ? pageNum * ps < apiTotal : false);
    return { summaries, hasNext: hasNextBool };
  }

  /**
   * Aggregate wholesale orders in a UTC date range for charting (paginates LeafLink newest-first until past range).
   * Only non-cancelled orders with total ≥ {@link ORDERS_ANALYTICS_MIN_ORDER_TOTAL} define “active” customers and series.
   * Sample lines: name/SKU/notes contain “sample” (see {@link isSampleLineItem}).
   */
  async getOrdersAnalytics(
    companyId: string,
    input: { dateFrom: string; dateTo: string },
  ): Promise<OrdersAnalyticsDto> {
    const dateFrom = cleanString(input.dateFrom);
    const dateTo = cleanString(input.dateTo);
    const fromMs = parseUtcDateOnlyToMs(dateFrom, false);
    const toMs = parseUtcDateOnlyToMs(dateTo, true);

    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
      throw new AppError("Invalid date range.", 400, "ORDERS_ANALYTICS_BAD_RANGE");
    }
    if ((toMs - fromMs) / 86_400_000 > MAX_ANALYTICS_RANGE_DAYS) {
      throw new AppError(`Date range cannot exceed ${MAX_ANALYTICS_RANGE_DAYS} days.`, 400, "ORDERS_ANALYTICS_RANGE_TOO_WIDE");
    }

    const creds = await this.leafLinkService.resolveRuntimeCredentials(companyId);
    const baseConfigured = Boolean(creds.apiKey && (creds.companyId || creds.companySlug));
    const dayList = enumerateUtcDaysInclusive(dateFrom, dateTo);
    const nDays = dayList.length;
    const dayIndex = new Map<string, number>();
    dayList.forEach((d, i) => dayIndex.set(d, i));

    if (!creds.integrationEnabled || !baseConfigured) {
      return {
        source: "leaflink",
        configured: baseConfigured,
        integrationEnabled: creds.integrationEnabled,
        dateFrom,
        dateTo,
        ordersIncluded: 0,
        minOrderTotal: ORDERS_ANALYTICS_MIN_ORDER_TOTAL,
        pagesScanned: 0,
        truncated: false,
        days: dayList,
        customers: [],
      };
    }

    await this.assertOrdersCapableOrThrow(creds);

    const collected: LeafLinkOrderSummaryDto[] = [];
    let pagesScanned = 0;
    let truncated = false;

    for (let page = 1; page <= MAX_ANALYTICS_PAGES; page++) {
      const res = await this.listOrdersSummaries(companyId, {
        page,
        pageSize: 100,
        ordering: "-created_on",
      });
      pagesScanned++;
      if (!res.summaries.length)
        break;

      const timestamps = res.summaries.map((o) => Date.parse(o.createdAt));
      const maxT = Math.max(...timestamps.filter(Number.isFinite));
      if (Number.isFinite(maxT) && maxT < fromMs)
        break;

      for (const o of res.summaries) {
        const t = Date.parse(o.createdAt);
        if (!Number.isFinite(t)) continue;
        if (t >= fromMs && t <= toMs)
          collected.push(o);
      }

      const minT = Math.min(...timestamps.filter(Number.isFinite));
      if (Number.isFinite(minT) && minT < fromMs && !res.hasNext)
        break;
      if (!res.hasNext)
        break;
      if (page === MAX_ANALYTICS_PAGES && res.hasNext)
        truncated = true;
    }

    type CustAgg = {
      label: string;
      lastPurchaseMs: number;
      revenueByDay: number[];
      orderCountByDay: number[];
      sampleUnitsByDay: number[];
      orderTotalSum: number;
      sampleTypeUnits: Map<string, number>;
    };

    const agg = new Map<string, CustAgg>();
    let qualifyingOrderCount = 0;

    for (const o of collected) {
      if (isCancelledOrder(o)) continue;
      const t = Date.parse(o.createdAt);
      if (!Number.isFinite(t)) continue;
      const money = orderTotalMoney(o);
      if (money < ORDERS_ANALYTICS_MIN_ORDER_TOTAL) continue;

      qualifyingOrderCount++;
      const day = utcDayKeyFromMs(t);
      const di = dayIndex.get(day);
      if (di === undefined) continue;

      const label = cleanString(o.customerName) || "Unknown customer";
      const ck = customerSeriesKey(o.buyerCustomerId, label);

      let row = agg.get(ck);
      if (!row) {
        row = {
          label,
          lastPurchaseMs: t,
          revenueByDay: Array.from({ length: nDays }, () => 0),
          orderCountByDay: Array.from({ length: nDays }, () => 0),
          sampleUnitsByDay: Array.from({ length: nDays }, () => 0),
          orderTotalSum: 0,
          sampleTypeUnits: new Map(),
        };
        agg.set(ck, row);
      }

      row.lastPurchaseMs = Math.max(row.lastPurchaseMs, t);
      row.orderTotalSum += money;
      row.revenueByDay[di] += money;
      row.orderCountByDay[di] += 1;

      for (const li of o.lineItems) {
        if (!isSampleLineItem(li)) continue;
        const q = li.quantity > 0 ? li.quantity : 1;
        row.sampleUnitsByDay[di] += q;
        const tl = sampleTypeLabelForLine(li);
        row.sampleTypeUnits.set(tl, (row.sampleTypeUnits.get(tl) ?? 0) + q);
      }
    }

    const customers: OrdersAnalyticsCustomerDto[] = [...agg.entries()]
      .map(([key, v]) => ({
        key,
        label: v.label,
        lastPurchaseDate: new Date(v.lastPurchaseMs).toISOString(),
        orderTotalInRange: Math.round(v.orderTotalSum * 100) / 100,
        sampleUnitsInRange: [...v.sampleTypeUnits.values()].reduce((a, b) => a + b, 0),
        samplesByType: [...v.sampleTypeUnits.entries()]
          .map(([typeLabel, units]) => ({ typeLabel, units }))
          .sort((a, b) => b.units - a.units),
        revenueByDay: v.revenueByDay.map((x) => Math.round(x * 100) / 100),
        orderCountByDay: v.orderCountByDay.map((x) => x),
        sampleUnitsByDay: v.sampleUnitsByDay.map((x) => x),
      }))
      .sort((a, b) => b.orderTotalInRange - a.orderTotalInRange);

    logInfo("[LEAFLINK] orders_analytics_done", {
      companyId,
      ordersIncluded: qualifyingOrderCount,
      pagesScanned,
      truncated,
      customerCount: customers.length,
    });

    return {
      source: "leaflink",
      configured: true,
      integrationEnabled: true,
      dateFrom,
      dateTo,
      ordersIncluded: qualifyingOrderCount,
      minOrderTotal: ORDERS_ANALYTICS_MIN_ORDER_TOTAL,
      pagesScanned,
      truncated,
      days: dayList,
      customers,
    };
  }

  /** Pull paginated summaries (warm cache + bookkeeping). Does not overwrite inventory. */
  async syncOrdersWarm(companyId: string): Promise<LeafLinkOrdersSyncDto> {
    clearTenantOrderCachePrefix(companyId);
    const creds = await this.leafLinkService.resolveRuntimeCredentials(companyId);
    const nowIso = new Date().toISOString();

    if (!creds.integrationEnabled || !baseOutConfiguredForOrders(creds)) {
      return {
        ok: true,
        configured: Boolean(creds.apiKey && (creds.companyId || creds.companySlug)),
        integrationEnabled: creds.integrationEnabled,
        pagesPulled: 0,
        ordersSeen: 0,
        lastFetchedAt: nowIso,
      };
    }
    await this.assertOrdersCapableOrThrow(creds);

    let pages = 0;
    let ordersSeen = 0;
    for (let p = 1; p <= 8; p++) {
      const res = await this.listOrders(companyId, {
        page: p,
        pageSize: 100,
        refresh: true,
        ordering: "-modified",
      });
      pages++;
      ordersSeen += res.orders.length;
      if (!res.hasNext) break;
    }

    logInfo("[LEAFLINK] orders_sync_complete", { companyId, pages, ordersSeen });
    return {
      ok: true,
      configured: true,
      integrationEnabled: true,
      pagesPulled: pages,
      ordersSeen,
      lastFetchedAt: new Date().toISOString(),
    };
  }
}

function baseOutConfiguredForOrders(creds: LeafLinkRuntimeCredentials): boolean {
  return Boolean(creds.apiKey && (creds.companyId || creds.companySlug));
}
