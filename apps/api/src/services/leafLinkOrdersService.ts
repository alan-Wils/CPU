import type { Prisma } from "@prisma/client";
import { AppError } from "../errors/AppError.js";
import { logInfo, logWarn } from "../lib/logger.js";
import {
  buildLeafLinkAuthCandidates,
  buildLeafLinkHeaders,
  fetchJsonWithRetry,
  leafLinkAuthMode,
  pickListSource,
  LeafLinkService,
  type LeafLinkCredentialSource,
  type LeafLinkResolvedCredentials,
  type LeafLinkRuntimeCredentials,
} from "./leaflinkService.js";
import {
  upsertLeafLinkStoredOrders,
  countLeafLinkStoredOrdersForCompany,
  findLeafLinkStoredOrdersForCompanyInRange,
  findRecentLeafLinkStoredOrdersWithNullCreatedOn,
  findRecentLeafLinkStoredOrdersForCompany,
  type LeafLinkStoredOrderUpsertInput,
} from "./leafLinkOrdersStorePrimitives.js";

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
  /** LeafLink wholesale line item flag (see API `is_sample`). */
  isSample: boolean;
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
  /** True when every LeafLink page was fetched (no `hasNext`) before hitting the page cap. */
  syncComplete?: boolean;
  /** True when stopping only because `LEAFLINK_ORDERS_FULL_SYNC_MAX_PAGES` was reached. */
  hitPageCap?: boolean;
};

/** Optional LeafLink list filters when paginating orders-received into `leafLinkStoredOrder`. */
export type PullLeafLinkOrdersReceivedOpts = {
  /** ISO UTC instant for LeafLink query `created_on__gte` (inclusive). */
  createdOnGteIso?: string;
  /** ISO UTC instant for LeafLink query `created_on__lte` (inclusive window end). */
  createdOnLteIso?: string;
};

export type OrdersAnalyticsSampleTypeBreakdown = {
  typeLabel: string;
  /** Units = sum of line quantities for that product label. */
  units: number;
};

export type OrdersAnalyticsSampleLineItemDto = {
  orderId: string;
  orderNumber: string;
  createdAt: string;
  productName: string;
  sku: string;
  quantity: number;
  typeLabel: string;
};

export type OrdersAnalyticsQualifyingOrderDto = {
  orderId: string;
  orderNumber: string;
  customerKey: string;
  createdAt: string;
  /** Per-order headline total (USD), not lifetime / not line-sum inflation. */
  totalUsd: number;
};

export type OrdersAnalyticsCustomerDto = {
  key: string;
  label: string;
  /** Latest order date in range (ISO 8601). */
  lastPurchaseDate: string;
  /** Total (USD) of that most recent order in the range. */
  lastOrderTotal: number;
  /** Sum of order totals in range. */
  orderTotalInRange: number;
  /** Sample line units in range (see sample detection heuristic). */
  sampleUnitsInRange: number;
  samplesByType: OrdersAnalyticsSampleTypeBreakdown[];
  /** Itemized sample lines from orders in range. */
  sampleLineItems: OrdersAnalyticsSampleLineItemDto[];
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
  /** Orders in range from saved snapshots (invoice headline totals when present; includes cancelled/sample-sized orders — no dollar floor). */
  ordersIncluded: number;
  /** Always 0 — no minimum order filter in analytics. Present for backwards-compatible clients. */
  minOrderTotal: number;
  pagesScanned: number;
  truncated: boolean;
  days: string[];
  /** Buyers present on stored orders whose order dates fall in this UTC window. */
  customers: OrdersAnalyticsCustomerDto[];
  /** One row per order for scatter chart. May be truncated — see `qualifyingOrdersTruncated`. */
  qualifyingOrders: OrdersAnalyticsQualifyingOrderDto[];
  qualifyingOrdersTruncated: boolean;
  /** Series are built from saved orders (see persisted rows when Orders / sync runs). */
  readFromDatabase: boolean;
  /** This request refreshed LeafLink into the DB before aggregating (`refresh=true`). */
  leafLinkRefreshRan: boolean;
  /** Stored rows overlapping the UTC date span (may exceed orders included after filters). */
  storedRowsInRange: number;
  /** Latest `updatedAt` among rows read for this range (`null` if none). */
  storedSnapshotMaxUpdatedAt: string | null;
  /** Legacy field — analytics no longer gates on LeafLink CRM customer status (always false / 0). */
  filteredByLeafLinkCurrentCustomerStatus: boolean;
  leafLinkCurrentCustomerCount: number;
};

const MAX_ANALYTICS_RANGE_DAYS = 366;
/** Hard safety: full sync stops after this many list pages (override with `LEAFLINK_ORDERS_FULL_SYNC_MAX_PAGES`). */
const DEFAULT_LEAF_LINK_FULL_SYNC_MAX_PAGES = 5000;
const ABS_LEAF_LINK_FULL_SYNC_MAX_PAGES = 50_000;
const MAX_QUALIFYING_ORDERS_IN_PAYLOAD = 3500;
/** If list payload embeds many line rows, summing them is often wrong vs order headline `total`. */
const MAX_LINE_ITEMS_TO_TRUST_SUM = 120;
/** Max Postgres rows hydrated for the Orders list when `refresh=false`. Must stay ≤ prisma cap in leafLinkOrdersStorePrimitives. */
const STORED_ORDERS_LIST_SCAN_LIMIT = 25_000;
const preferredLeafLinkAuthByTenant = new Map<string, string>();

function leafLinkOrdersFullSyncMaxPages(): number {
  const raw = String(process.env.LEAFLINK_ORDERS_FULL_SYNC_MAX_PAGES ?? "").trim();
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_LEAF_LINK_FULL_SYNC_MAX_PAGES;
  if (!Number.isFinite(n) || n < 1)
    return DEFAULT_LEAF_LINK_FULL_SYNC_MAX_PAGES;
  return Math.min(Math.floor(n), ABS_LEAF_LINK_FULL_SYNC_MAX_PAGES);
}

/**
 * Shipped in API responses for compatibility; analytics does not exclude small orders (date range only on saved orders).
 * @deprecated Prefer checking `minOrderTotal === 0` in clients; kept exported to avoid breaking imports.
 */
export const ORDERS_ANALYTICS_MIN_ORDER_TOTAL = 0;

/**
 * Match order buyer ids across numeric / string shapes (leading zeros etc.).
 */
function canonicalLeafLinkBuyerId(raw: unknown): string {
  const s = cleanString(typeof raw === "number" && Number.isFinite(raw) ? String(Math.trunc(raw)) : raw);
  if (!s || s.includes("://")) return "";
  if (/^-?\d+$/.test(s)) {
    try {
      return BigInt(s).toString();
    } catch {
      return s;
    }
  }
  const u = s.trim().toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(u))
    return u;
  return s.trim();
}

/** Raw fields LeafLink orders may expose for linking the same wholesale buyer across payloads. */
const LEAF_LINK_CUSTOMER_ID_FIELD_NAMES = [
  "id",
  "pk",
  "customer_id",
  "buyer_customer_id",
  "crm_record_id",
  "crm_id",
  "leaflink_crm_record_id",
  /** Export column `CUSTOMER_EXTERNAL_ID` — sparse but must match when set. */
  "external_id",
  "business_identifier",
] as const;

function canonicalIdsFromSellerRecord(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const pushCanon = (raw: unknown) => {
    const c = canonicalLeafLinkBuyerId(raw);
    if (c && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  };
  for (const fn of LEAF_LINK_CUSTOMER_ID_FIELD_NAMES)
    pushCanon(row[fn]);

  const nestObjs: unknown[] = [row.buyer, row.retailer];
  const cust = row.customer;
  if (cust != null && typeof cust === "object" && !Array.isArray(cust))
    nestObjs.push(cust);

  for (const n of nestObjs) {
    if (n != null && typeof n === "object" && !Array.isArray(n)) {
      const rec = asRecord(n);
      for (const fn of LEAF_LINK_CUSTOMER_ID_FIELD_NAMES)
        pushCanon(rec[fn]);
    }
  }
  return out;
}

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

function nestedOrderRecord(row: Record<string, unknown>): Record<string, unknown> {
  const o = row.order;
  return o != null && typeof o === "object" && !Array.isArray(o) ? asRecord(o) : {};
}

function fieldIsoDate(v: unknown): string {
  if (v instanceof Date && Number.isFinite(v.getTime())) return v.toISOString();
  const s = cleanString(typeof v === "string" ? v : String(v ?? ""));
  if (!s || s.includes("</")) return "";
  /** Accept RFC3339 or date-only strings */
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? s : "";
}

/**
 * Wholesale order payloads differ by endpoint; normalize created timestamps so DB range queries & analytics UTC bucketing agree.
 */
function leafLinkOrderCreatedIso(row: Record<string, unknown>): string {
  const nest = nestedOrderRecord(row);
  /** Cover list vs detail quirks so `LeafLinkStoredOrder.createdOn` is rarely null (range queries + analytics). */
  const keys: unknown[] = [
    row.created_on,
    row.created_at,
    row.created,
    row.date_created,
    row.order_date,
    row.order_date_datetime,
    row.date_ordered,
    row.timestamp,
    row.placed_at,
    row.order_placed_date,
    row.submitted_on,
    row.submitted_at,
    row.submitted_date,
    row.inserted_at,
    nest.created_on,
    nest.created_at,
    nest.created,
    nest.order_date,
    nest.order_date_datetime,
    nest.date_ordered,
    nest.submitted_on,
    nest.submitted_at,
    nest.timestamp,
    nest.placed_at,
  ];
  for (const k of keys) {
    const iso = fieldIsoDate(k);
    if (iso) return iso;
  }
  return "";
}

function idLikeFromBuyerObject(o: Record<string, unknown>): string {
  /** Prefer opaque ids; reject full URLs mistaken for ids. Match LeafLink Customers / CRM linkage fields. */
  const direct =
    cleanString(
      o.id
      ?? o.pk
      ?? o.customer_id
      ?? o.uuid
      ?? o.buyer_customer_id
      ?? o.buyer
      ?? o.retailer_id
      ?? o.retailer
      ?? o.crm_record_id
      ?? o.crm_id
      ?? o.leaflink_crm_record_id
      ?? o.external_id,
    );
  if (!direct || direct.includes("http") || direct.includes("://"))
    return "";
  return direct;
}

/**
 * Buyer linkage varies (nested customer, FK int, `{ id }`, CRM-style ids on some payloads).
 */
function leafLinkBuyerCustomerId(row: Record<string, unknown>): string {
  const customer =
    row.customer != null && typeof row.customer === "object" && !Array.isArray(row.customer)
      ? asRecord(row.customer)
      : {};
  const nest = nestedOrderRecord(row);
  const nestCust =
    nest.customer != null && typeof nest.customer === "object" && !Array.isArray(nest.customer)
      ? asRecord(nest.customer)
      : {};

  let id = idLikeFromBuyerObject(customer);
  if (id) return id;

  id = idLikeFromBuyerObject(nestCust);
  if (id) return id;

  const b = row.buyer ?? nest.buyer;
  if (typeof b === "number" && Number.isFinite(b)) return String(Math.trunc(b));

  const bs = cleanString(b);
  if (bs && !bs.includes("://")) return bs;

  if (b != null && typeof b === "object" && !Array.isArray(b))
    return idLikeFromBuyerObject(asRecord(b));

  return cleanString(row.buyer_id ?? row.buyer_company_id ?? row.customer_id ?? row.retailer ?? row.buyer_company);
}

/** Prefer LeafLink headline totals; never substitute a huge embedded line-item sum when headline exists. */
function effectiveOrderTotalUsd(raw: Record<string, unknown>, summary: LeafLinkOrderSummaryDto): number {
  const nest = nestedOrderRecord(raw);
  const headline =
    moneyAmount(raw.total)
    ?? moneyAmount(nest.total)
    ?? moneyAmount(raw.grand_total)
    ?? moneyAmount(raw.final_total)
    ?? moneyAmount(raw.order_total);

  const lines = summary.lineItems;
  const linesSum = lines.reduce((acc, li) => acc + (li.lineTotal ?? 0), 0);
  const lineCount = lines.length;

  const rawSub = moneyAmount(raw.subtotal) ?? moneyAmount(nest.subtotal);

  if (headline != null && headline > 0) {
    /** Some list embeds return bloated `line_items`; keep the API order total. */
    if (lineCount > MAX_LINE_ITEMS_TO_TRUST_SUM && linesSum > headline * 5)
      return headline;
    return headline;
  }

  if (rawSub != null && rawSub > 0)
    return rawSub;

  if (lineCount === 0 || linesSum <= 0)
    return 0;

  if (lineCount > MAX_LINE_ITEMS_TO_TRUST_SUM)
    return 0;

  return linesSum;
}

function isCancelledOrder(o: LeafLinkOrderSummaryDto): boolean {
  return o.statusNormalized === "Cancelled";
}

function productRecordIndicatesSample(p: Record<string, unknown>): boolean {
  const blob = [
    p.listing_status,
    p.seller_listing_state,
    p.status,
    p.product_state,
    p.inventory_status,
    p.availability_display,
    p.product_availability_display,
    p.license_type,
    p.marketplace_status,
  ]
    .map(cleanString)
    .join(" ")
    .toLowerCase();
  return blob.includes("sample");
}

/** Primary: LeafLink `is_sample` on line item + product/sample status; fallback text match on name/SKU/notes. */
function isSampleLineItem(li: LeafLinkOrderLineItemDto): boolean {
  if (li.isSample)
    return true;
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
    const mergedSample = e.isSample || a.isSample;
    const eBad = isPlaceholderProductLabel(e.productName);
    const aGood = !isPlaceholderProductLabel(a.productName);
    if (aGood && eBad) {
      return {
        ...e,
        productName: a.productName,
        sku: cleanString(a.sku) || e.sku,
        isSample: mergedSample,
      };
    }
    if (!cleanString(e.sku) && cleanString(a.sku))
      return { ...e, sku: a.sku, isSample: mergedSample };
    if (mergedSample !== e.isSample)
      return { ...e, isSample: mergedSample };
    return e;
  });
}

async function fetchOrderLineItemsRaw(
  creds: LeafLinkRuntimeCredentials,
  authSource: LeafLinkCredentialSource,
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
  const { body } = await leafLinkAuthedGet(urls, creds, authSource, 30_000);
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
  authSource: LeafLinkCredentialSource,
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
      const { body } = await leafLinkAuthedGet(urls, creds, authSource, 12_000);
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
  authSource: LeafLinkCredentialSource,
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
    return hydrateLineItemsViaProductDetails(creds, authSource, baseRaw, embedded);

  let items = embedded;
  try {
    const rawLines = await fetchOrderLineItemsRaw(creds, authSource, baseRaw, orderApiKey);
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

  return hydrateLineItemsViaProductDetails(creds, authSource, baseRaw, items);
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
    const prodObj =
      prodRaw != null && typeof prodRaw === "object" && !Array.isArray(prodRaw) ? asRecord(prodRaw) : null;
    const listing =
      r.listing != null && typeof r.listing === "object" && !Array.isArray(r.listing)
        ? asRecord(r.listing)
        : {};
    const inv =
      r.inventory_item != null && typeof r.inventory_item === "object" && !Array.isArray(r.inventory_item)
        ? asRecord(r.inventory_item)
        : {};
    if (!productName) {
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

    const fr = r.frozen_data != null && typeof r.frozen_data === "object" && !Array.isArray(r.frozen_data)
      ? asRecord(r.frozen_data)
      : null;
    const fdSample =
      fr != null && (fr.is_sample === true || cleanString(fr.is_sample).toLowerCase() === "true");
    const isSample =
      r.is_sample === true
      || cleanString(r.is_sample).toLowerCase() === "true"
      || fdSample
      || (prodObj != null && productRecordIndicatesSample(prodObj))
      || productRecordIndicatesSample(listing)
      || productRecordIndicatesSample(inv);

    out.push({
      id: cleanString(r.id) || `line-${i}`,
      productName: productName || `Product ${productId || `#${i + 1}`}`,
      sku,
      quantity: qty,
      unitPrice,
      lineTotal,
      notes: cleanString(r.notes),
      productId,
      isSample,
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

export function normalizeOrder(raw: unknown): LeafLinkOrderSummaryDto {
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
    createdAt:
      leafLinkOrderCreatedIso(row) || cleanString(row.created_on || row.created_at || ""),
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
    buyerCustomerId: leafLinkBuyerCustomerId(row) || cleanString(customer.id ?? row.buyer),
  };
}

export function orderToCardDto(o: LeafLinkOrderSummaryDto): LeafLinkOrderCardDto {
  const { lineItems, ...rest } = o;
  return { ...rest, itemCount: lineItems.length };
}

export type LeafLinkPaymentMatchCandidateDto = {
  leafLinkKey: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  total: number;
  outstandingBalance: number | null;
  status: string;
  paymentStatus: string;
  deliveryDate: string | null;
  lineItems: LeafLinkOrderLineItemDto[];
  score: number;
  matchedBy: string[];
};

/** Detail upserts wrap our normalized summary so sample flags & enriched lines stay intact. */
const CPU_DETAIL_V = 1 as const;
type CpuDetailPayload = { _cpu_v: typeof CPU_DETAIL_V; summary: LeafLinkOrderSummaryDto };

function isCpuDetailPayload(p: unknown): p is CpuDetailPayload {
  return (
    typeof p === "object"
    && p !== null
    && (p as CpuDetailPayload)._cpu_v === CPU_DETAIL_V
    && typeof (p as CpuDetailPayload).summary === "object"
    && (p as CpuDetailPayload).summary !== null
  );
}

function syntheticRawForTotalsFromSummary(summary: LeafLinkOrderSummaryDto): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  if (summary.total !== null && summary.total !== undefined)
    raw.total = summary.total;
  if (summary.subtotal !== null && summary.subtotal !== undefined)
    raw.subtotal = summary.subtotal;
  return raw;
}

function collectedPairFromStoredPayload(payload: unknown): { raw: Record<string, unknown>; summary: LeafLinkOrderSummaryDto } | null {
  if (isCpuDetailPayload(payload)) {
    const summary = payload.summary;
    return { raw: syntheticRawForTotalsFromSummary(summary), summary };
  }
  if (payload != null && typeof payload === "object" && !Array.isArray(payload))
    return { raw: payload as Record<string, unknown>, summary: normalizeOrder(payload) };
  return null;
}

function toUpsertInputFromLeafLinkPayload(
  raw: Record<string, unknown>,
  summary: LeafLinkOrderSummaryDto,
  sourcePage?: number | null,
): LeafLinkStoredOrderUpsertInput | null {
  const leafLinkKey = cleanString(summary.id) || cleanString(summary.orderNumber);
  if (!leafLinkKey) return null;
  const createdIsoText = cleanString(summary.createdAt) || leafLinkOrderCreatedIso(raw);
  const cp = Date.parse(createdIsoText || "");
  const createdOn = Number.isFinite(cp) ? new Date(cp) : null;
  const money = effectiveOrderTotalUsd(raw, summary);
  return {
    leafLinkKey,
    buyerCustomerId: summary.buyerCustomerId || "",
    customerName: summary.customerName || "",
    statusRaw: summary.status || "",
    createdOn,
    totalUsd: Number.isFinite(money) ? money : null,
    payload: raw as Prisma.InputJsonValue,
    sourcePage: sourcePage ?? null,
  };
}

async function persistLeafLinkOrderListRows(
  companyId: string,
  apiRows: unknown[],
  sourcePage?: number,
): Promise<void> {
  const cid = cleanString(companyId);
  if (!cid || !Array.isArray(apiRows) || apiRows.length === 0)
    return;
  try {
    const inputs: LeafLinkStoredOrderUpsertInput[] = [];
    for (const item of apiRows) {
      const raw =
        item != null && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : null;
      if (!raw) continue;
      const summary = normalizeOrder(item);
      const row = toUpsertInputFromLeafLinkPayload(raw, summary, sourcePage ?? null);
      if (row) inputs.push(row);
    }
    if (inputs.length) {
      await upsertLeafLinkStoredOrders(cid, inputs);
      logInfo("[LEAFLINK] orders_saved_to_db", { companyId: cid, rows: inputs.length, sourcePage });
    }
  }
  catch (err) {
    logWarn("[LEAFLINK] orders_save_to_db_failed", { err: err instanceof Error ? err.message : String(err) });
  }
}

async function persistLeafLinkFetchedOrderPairs(
  companyId: string,
  pairs: { raw: Record<string, unknown>; summary: LeafLinkOrderSummaryDto }[],
  sourcePage?: number,
): Promise<void> {
  const cid = cleanString(companyId);
  if (!cid || !pairs.length) return;
  try {
    const inputs: LeafLinkStoredOrderUpsertInput[] = [];
    for (const { raw, summary } of pairs) {
      const row = toUpsertInputFromLeafLinkPayload(raw, summary, sourcePage ?? null);
      if (row) inputs.push(row);
    }
    if (inputs.length) {
      await upsertLeafLinkStoredOrders(cid, inputs);
      logInfo("[LEAFLINK] orders_saved_to_db_pairs", { companyId: cid, rows: inputs.length, sourcePage });
    }
  }
  catch (err) {
    logWarn("[LEAFLINK] orders_save_pairs_failed", { err: err instanceof Error ? err.message : String(err) });
  }
}

async function persistLeafLinkDetailSummaryRow(companyId: string, summary: LeafLinkOrderSummaryDto): Promise<void> {
  const cid = cleanString(companyId);
  const leafLinkKey = cleanString(summary.id) || cleanString(summary.orderNumber);
  if (!cid || !leafLinkKey) return;
  try {
    const rawTotals = syntheticRawForTotalsFromSummary(summary);
    const money = effectiveOrderTotalUsd(rawTotals, summary);
    const cp = Date.parse(summary.createdAt || "");
    const createdOn = Number.isFinite(cp) ? new Date(cp) : null;
    const boxed: CpuDetailPayload = { _cpu_v: CPU_DETAIL_V, summary };
    await upsertLeafLinkStoredOrders(cid, [
      {
        leafLinkKey,
        buyerCustomerId: summary.buyerCustomerId || "",
        customerName: summary.customerName || "",
        statusRaw: summary.status || "",
        createdOn,
        totalUsd: Number.isFinite(money) ? money : null,
        payload: boxed as unknown as Prisma.InputJsonValue,
        sourcePage: null,
      },
    ]);
    logInfo("[LEAFLINK] orders_saved_detail_db", { companyId: cid, leafLinkKey });
  }
  catch (err) {
    logWarn("[LEAFLINK] orders_detail_save_to_db_failed", { err: err instanceof Error ? err.message : String(err) });
  }
}

async function leafLinkAuthedGet(
  urls: string[],
  creds: LeafLinkRuntimeCredentials,
  authSource: LeafLinkCredentialSource,
  timeoutMs: number,
): Promise<{ url: string; authMode: string; body: unknown }> {
  const authCandidates = orderedAuthCandidatesForTenant(creds);
  const tenantKey = authTenantKey(creds);
  let lastErr: unknown;
  for (const url of urls) {
    if (!url) continue;
    for (const authValue of authCandidates) {
      const authMode = leafLinkAuthMode(authValue);
      const init: RequestInit = {
        method: "GET",
        headers: buildLeafLinkHeaders(creds, authValue),
      };
      try {
        logInfo("[LEAFLINK] orders_request", {
          url: url.slice(0, 200),
          authMode,
          authSource,
          companyId: creds.companyId || null,
        });
        const body = await fetchJsonWithRetry(url, init, timeoutMs);
        preferredLeafLinkAuthByTenant.set(tenantKey, authValue);
        return { url, authMode, body };
      }
      catch (err) {
        lastErr = err;
        const code = err instanceof AppError ? err.code : "";
        const preferred = preferredLeafLinkAuthByTenant.get(tenantKey);
        if (
          preferred
          && preferred === authValue
          && (
            code === "LEAFLINK_INVALID_CREDENTIALS"
            || code === "LEAFLINK_REQUEST_FAILED"
            || code === "LEAFLINK_HTML_ERROR"
            || code === "LEAFLINK_NON_JSON_RESPONSE"
            || code === "LEAFLINK_TEMPORARY"
          )
        ) {
          preferredLeafLinkAuthByTenant.delete(tenantKey);
        }
        if (
          code === "LEAFLINK_INVALID_CREDENTIALS"
          || code === "LEAFLINK_REQUEST_FAILED"
          || code === "LEAFLINK_HTML_ERROR"
          || code === "LEAFLINK_NON_JSON_RESPONSE"
          || code === "LEAFLINK_TEMPORARY"
        ) {
          logInfo("[LEAFLINK] orders_fallback_attempt", {
            companyId: creds.companyId || null,
            authSource,
            authMode,
            fallbackTriggered: true,
            url: url.slice(0, 160),
            reasonCode: code || "UNKNOWN",
            reason: err instanceof Error ? err.message : String(err),
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

async function leafLinkAuthedRequest(
  urls: string[],
  creds: LeafLinkRuntimeCredentials,
  authSource: LeafLinkCredentialSource,
  timeoutMs: number,
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
): Promise<{ url: string; authMode: string; body: unknown }> {
  const authCandidates = orderedAuthCandidatesForTenant(creds);
  const tenantKey = authTenantKey(creds);
  let lastErr: unknown;
  for (const url of urls) {
    if (!url) continue;
    for (const authValue of authCandidates) {
      const authMode = leafLinkAuthMode(authValue);
      const init: RequestInit = {
        method,
        headers: buildLeafLinkHeaders(creds, authValue, { contentType: "application/json" }),
        body: JSON.stringify(body),
      };
      try {
        logInfo("[LEAFLINK] orders_write_request", {
          url: url.slice(0, 200),
          authMode,
          authSource,
          companyId: creds.companyId || null,
          method,
        });
        const json = await fetchJsonWithRetry(url, init, timeoutMs);
        preferredLeafLinkAuthByTenant.set(tenantKey, authValue);
        return { url, authMode, body: json };
      } catch (err) {
        lastErr = err;
        const code = err instanceof AppError ? err.code : "";
        const preferred = preferredLeafLinkAuthByTenant.get(tenantKey);
        if (
          preferred
          && preferred === authValue
          && (
            code === "LEAFLINK_INVALID_CREDENTIALS"
            || code === "LEAFLINK_REQUEST_FAILED"
            || code === "LEAFLINK_HTML_ERROR"
            || code === "LEAFLINK_NON_JSON_RESPONSE"
            || code === "LEAFLINK_TEMPORARY"
          )
        ) {
          preferredLeafLinkAuthByTenant.delete(tenantKey);
        }
        if (
          code === "LEAFLINK_INVALID_CREDENTIALS"
          || code === "LEAFLINK_REQUEST_FAILED"
          || code === "LEAFLINK_HTML_ERROR"
          || code === "LEAFLINK_NON_JSON_RESPONSE"
          || code === "LEAFLINK_TEMPORARY"
        ) {
          logInfo("[LEAFLINK] orders_write_fallback_attempt", {
            companyId: creds.companyId || null,
            authSource,
            authMode,
            fallbackTriggered: true,
            url: url.slice(0, 160),
            reasonCode: code || "UNKNOWN",
            reason: err instanceof Error ? err.message : String(err),
          });
          continue;
        }
        throw err;
      }
    }
  }
  if (lastErr instanceof AppError) throw lastErr;
  throw lastErr instanceof Error ? lastErr : new AppError("LeafLink request failed.", 502, "LEAFLINK_ORDERS_FAILED");
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

  /**
   * Prefer global v2 orders endpoint first.
   * Some tenants reject company-scoped orders URLs with 401/403 while the global endpoint
   * succeeds with identical credentials; putting global first avoids repeated fallback churn
   * during deep pagination (e.g. analytics/history backfills).
   */
  {
    const u = new URL(`${root}/v2/orders-received/`);
    merged.forEach((v, k) => u.searchParams.set(k, v));
    u.searchParams.set("fields_add", "line_items,customer,sales_reps");
    candidates.push(u.href);
  }
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
  const seen = new Set<string>();
  return candidates.filter((href) => {
    if (!href || seen.has(href)) return false;
    seen.add(href);
    return true;
  });
}

function coerceLeafLinkAggregateCount(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw))
    return 0;
  const n = Math.floor(raw);
  return n >= 0 ? n : 0;
}

function pickOrdersListAggregateTotal(root: Record<string, unknown>): number {
  /** DRF-ish `count`; some tenants expose only `total` / `total_count`. */
  for (const k of ["count", "total", "total_count"] as const) {
    const v = coerceLeafLinkAggregateCount(root[k]);
    if (v > 0) return v;
  }
  const meta = typeof root.meta === "object" && root.meta !== null ? asRecord(root.meta) : null;
  if (meta) {
    for (const k of ["count", "total", "total_count"] as const) {
      const v = coerceLeafLinkAggregateCount(meta[k]);
      if (v > 0) return v;
    }
  }
  return 0;
}

/** `next` / `previous` on list responses; tolerate nested `links` seen on some wrappers. */
function pickPagedUrlFromRoot(root: Record<string, unknown>, key: "next" | "previous"): string | null {
  const top = typeof root[key] === "string" ? String(root[key]).trim() : "";
  if (top) return top;
  const links = root.links;
  if (links != null && typeof links === "object" && !Array.isArray(links)) {
    const v = typeof (links as Record<string, unknown>)[key] === "string"
      ? String((links as Record<string, unknown>)[key]).trim()
      : "";
    if (v) return v;
  }
  return null;
}

/**
 * Parse LeafLink wholesale list envelopes (`results`/`data`/…) plus pagination metadata without
 * overstating totals (never infer catalogue size from page length alone — that prematurely clears `hasNext`).
 */
export function parseLeafLinkOrdersListEnvelope(body: unknown): {
  list: unknown[];
  totalCount: number;
  next: string | null;
  previous: string | null;
} {
  const root = asRecord(body);
  const totalCount = pickOrdersListAggregateTotal(root);
  const { list } = pickListSource(body);
  const next = pickPagedUrlFromRoot(root, "next");
  const previous = pickPagedUrlFromRoot(root, "previous");
  return { list, totalCount, next, previous };
}

/** Shared termination rule between live list + stored full-sync pagination. */
function leafLinkPagedHasMore(opts: {
  pageNum: number;
  pageSize: number;
  aggregateTotal: number;
  nextUrl: string | null;
  rowsOnPage: number;
}): boolean {
  const ps = opts.pageSize;
  const pn = opts.pageNum;
  const trimmedNext = opts.nextUrl?.trim() ?? "";
  if (trimmedNext.length > 0) return true;
  const agg = opts.aggregateTotal;
  if (agg > 0 && pn * ps < agg) return true;
  const r = opts.rowsOnPage;
  /**
   * Unknown aggregate + missing `next`: LeafLink frequently returns fewer rows than requested
   * `page_size` when `fields_add=line_items`. If the slice still looks full vs common upstream caps (~50–100),
   * keep paginating until an empty page terminates the caller loop.
   */
  if (agg <= 0 && r > 0 && r >= Math.min(ps, 50))
    return true;
  return false;
}

/** Light in-process cache for identical list reads (TTL). */
const LIST_CACHE_TTL_MS = 45_000;
const listCaches = new Map<string, { at: number; payload: LeafLinkOrdersListDto }>();

function authTenantKey(creds: LeafLinkRuntimeCredentials): string {
  return `${cleanString(creds.baseUrl)}|${cleanString(creds.companyId || creds.companySlug || "global")}`;
}

function orderedAuthCandidatesForTenant(creds: LeafLinkRuntimeCredentials): string[] {
  const all = buildLeafLinkAuthCandidates(creds);
  const preferred = preferredLeafLinkAuthByTenant.get(authTenantKey(creds));
  if (!preferred || !all.includes(preferred))
    return all;
  return [preferred, ...all.filter((v) => v !== preferred)];
}

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

  private async listOrdersFromStored(
    companyId: string,
    input: {
      page: number;
      pageSize: number;
      status?: string;
      ordering?: string;
      search?: string;
    },
    baseOut: Omit<LeafLinkOrdersListDto, "orders" | "totalCount" | "hasNext" | "hasPrevious" | "lastFetchedAt" | "fromCache">,
  ): Promise<LeafLinkOrdersListDto | null> {
    const syncedTotal = await countLeafLinkStoredOrdersForCompany(companyId);
    const fetchLimit = Math.min(STORED_ORDERS_LIST_SCAN_LIMIT, Math.max(syncedTotal, 1));
    const storedRows = await findRecentLeafLinkStoredOrdersForCompany(companyId, fetchLimit);
    if (!storedRows.length) return null;

    if (syncedTotal > STORED_ORDERS_LIST_SCAN_LIMIT) {
      logWarn("[LEAFLINK] orders_list_from_stored_truncated", {
        companyId,
        syncedTotal,
        rowsLoaded: storedRows.length,
        scanCap: STORED_ORDERS_LIST_SCAN_LIMIT,
      });
    }

    const statusFilter = cleanString(input.status).toLowerCase();
    const needleRaw = cleanString(input.search).toLowerCase();
    const needle = needleRaw.length >= 2 ? needleRaw : "";
    const ordering = cleanString(input.ordering) || "-created_on";

    let cards = storedRows
      .map((r) => {
        const pair = collectedPairFromStoredPayload(r.payload);
        return pair ? orderToCardDto(pair.summary) : null;
      })
      .filter((c): c is LeafLinkOrderCardDto => Boolean(c));

    if (statusFilter && statusFilter !== "all") {
      cards = cards.filter((c) => {
        const raw = cleanString(c.status).toLowerCase();
        const norm = cleanString(c.statusNormalized).toLowerCase();
        return raw === statusFilter || norm === statusFilter;
      });
    }

    if (needle) {
      cards = cards.filter((c) => {
        const on = cleanString(c.orderNumber).toLowerCase();
        const cn = cleanString(c.customerName).toLowerCase();
        return on.includes(needle) || cn.includes(needle);
      });
    }

    cards.sort((a, b) => {
      const ta = Date.parse(a.createdAt || "") || 0;
      const tb = Date.parse(b.createdAt || "") || 0;
      return ordering.startsWith("-") ? tb - ta : ta - tb;
    });

    const page = Math.max(1, input.page);
    const pageSize = Math.min(500, Math.max(1, input.pageSize));
    const totalCount = cards.length;
    const start = (page - 1) * pageSize;
    const orders = cards.slice(start, start + pageSize);
    const nowIso = new Date().toISOString();

    return {
      ...baseOut,
      page,
      pageSize,
      ordering,
      orders,
      totalCount,
      hasNext: start + pageSize < totalCount,
      hasPrevious: page > 1,
      lastFetchedAt: nowIso,
      fromCache: true,
    };
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
    logInfo("[LEAFLINK] credentials_resolved", {
      companyId,
      authSource: creds.source,
      fromDb: creds.source === "db",
      fromEnv: creds.source === "env",
    });

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

    if (!input.refresh) {
      const cached = await this.listOrdersFromStored(companyId, input, baseOut);
      if (cached)
        return cached;
    }

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
          const got = await leafLinkAuthedGet(urls, creds, creds.source, 25_000);
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

        const { list, totalCount: pullAggTotal, next: pullNext } = parseLeafLinkOrdersListEnvelope(body);

        await persistLeafLinkOrderListRows(companyId, list, pg);

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

        const searchPs = Math.min(
          500,
          Math.max(1, Number.parseInt(searchParams.get("page_size") || "100", 10) || 100),
        );
        const hasMoreMerged = leafLinkPagedHasMore({
          pageNum: pg,
          pageSize: searchPs,
          aggregateTotal: pullAggTotal,
          nextUrl: pullNext,
          rowsOnPage: Array.isArray(list) ? list.length : 0,
        });
        if (!hasMoreMerged) break;
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

    const { authMode, body } = await leafLinkAuthedGet(urls, creds, creds.source, 20_000);
    logInfo("[LEAFLINK] orders_list_ok", { authMode, page: input.page });

    const { list, totalCount: apiTotal, next } = parseLeafLinkOrdersListEnvelope(body);

    /** If API exposes no aggregate count but `next` exists, approximate hasNext without total. */
    const orders = list.map((r) => orderToCardDto(normalizeOrder(r)));
    const rawRoot = asRecord(body);
    const nextUrl = next?.trim() ?? "";

    const ps = Number(searchParams.get("page_size")) || orders.length || 18;
    const pageNum = Number(searchParams.get("page")) || 1;

    await persistLeafLinkOrderListRows(companyId, list, pageNum);

    const hasNextBool = leafLinkPagedHasMore({
      pageNum,
      pageSize: ps,
      aggregateTotal: apiTotal,
      nextUrl,
      rowsOnPage: orders.length,
    });
    const hasPrevBool = pageNum > 1;

    /** Never treat `orders.length` as catalogue total unless the API publishes an aggregate (`count`). */
    let totalCount =
      apiTotal > 0
        ? apiTotal
        : (hasNextBool ? pageNum * ps + orders.length : (pageNum - 1) * ps + orders.length);

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
    logInfo("[LEAFLINK] credentials_resolved", {
      companyId,
      authSource: creds.source,
      fromDb: creds.source === "db",
      fromEnv: creds.source === "env",
    });
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
    const { authMode, body } = await leafLinkAuthedGet(urls, creds, creds.source, 25_000);
    logInfo("[LEAFLINK] orders_detail_ok", { authMode });
    const row = typeof body === "object" && body !== null && !Array.isArray(body) ? body : null;
    if (!row) return null;

    /** Single-object detail may omit results wrapper */
    const r = row as Record<string, unknown>;
    if (!cleanString(r.id || r.order_id || r.number || r.order_number || r.short_id || r.order_short_number))
      return null;

    const summary = normalizeOrder(body);
    const lineItems = await enrichDetailLineItems(creds, creds.source, base, r, summary.lineItems);
    const full: LeafLinkOrderSummaryDto = {
      ...summary,
      lineItems,
      itemCount: lineItems.length,
    };
    await persistLeafLinkDetailSummaryRow(companyId, full);
    return full;
  }

  /**
   * One HTTP page of order summaries (`fields_add=line_items`) using already-resolved credentials.
   * Avoids resolving credentials/logging on every page (full sync loops).
   */
  private async fetchOrdersSummariesPageWithCreds(
    creds: LeafLinkResolvedCredentials,
    input: {
      page: number;
      pageSize: number;
      ordering?: string;
      /** LeafLink `created_on__gte` (ISO 8601). */
      createdOnGteIso?: string;
      /** LeafLink `created_on__lte` (ISO 8601). */
      createdOnLteIso?: string;
    },
  ): Promise<{
    rows: { raw: Record<string, unknown>; summary: LeafLinkOrderSummaryDto }[];
    hasNext: boolean;
  }> {
    if (!creds.integrationEnabled || !baseOutConfiguredForOrders(creds))
      return { rows: [], hasNext: false };

    const base = creds.baseUrl.replace(/\/+$/, "");
    const ordering = cleanString(input.ordering) || "-created_on";
    const searchParams = new URLSearchParams();
    searchParams.set("page", String(Math.max(1, input.page)));
    searchParams.set("page_size", String(Math.min(500, Math.max(1, input.pageSize))));
    searchParams.set("ordering", ordering);
    const gte = cleanString(input.createdOnGteIso);
    const lte = cleanString(input.createdOnLteIso);
    if (gte)
      searchParams.set("created_on__gte", gte);
    if (lte)
      searchParams.set("created_on__lte", lte);
    const urls = buildOrdersListUrlCandidates(base, creds, searchParams);
    const { body } = await leafLinkAuthedGet(urls, creds, creds.source, 20_000);
    const { list, totalCount: apiTotal, next } = parseLeafLinkOrdersListEnvelope(body);
    const rows = list.map((row) => {
      const raw = typeof row === "object" && row !== null && !Array.isArray(row) ? asRecord(row) : {};
      return { raw, summary: normalizeOrder(row) };
    });
    const pageNum = Math.max(1, input.page);
    const ps = Math.min(500, Math.max(1, input.pageSize));
    const nextUrl = next?.trim() ?? "";
    const hasNextBool = leafLinkPagedHasMore({
      pageNum,
      pageSize: ps,
      aggregateTotal: apiTotal,
      nextUrl,
      rowsOnPage: rows.length,
    });
    return { rows, hasNext: hasNextBool };
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
      /** LeafLink `created_on__gte` (ISO 8601). */
      createdOnGteIso?: string;
      /** LeafLink `created_on__lte` (ISO 8601). */
      createdOnLteIso?: string;
    },
  ): Promise<{
    rows: { raw: Record<string, unknown>; summary: LeafLinkOrderSummaryDto }[];
    hasNext: boolean;
  }> {
    const creds = await this.leafLinkService.resolveRuntimeCredentials(companyId);
    logInfo("[LEAFLINK] credentials_resolved", {
      companyId,
      authSource: creds.source,
      fromDb: creds.source === "db",
      fromEnv: creds.source === "env",
    });
    if (!creds.integrationEnabled || !baseOutConfiguredForOrders(creds))
      return { rows: [], hasNext: false };

    await this.assertOrdersCapableOrThrow(creds);
    return this.fetchOrdersSummariesPageWithCreds(creds, input);
  }

  /**
   * Paginate LeafLink `orders-received` until the API reports no next page (or until the configurable page cap).
   * Persists each page — same backing store as the Orders page (`leafLinkStoredOrder`).
   * Omit `filters` to sync the full catalogue; pass `createdOn*` to scope to LeafLink order `created_on`.
   * Pass {@link reuseCreds} when the caller already resolved credentials so each page does not resolve/log again.
   */
  async pullLeafLinkOrdersReceivedToDb(
    companyId: string,
    filters?: PullLeafLinkOrdersReceivedOpts,
    reuseCreds?: LeafLinkResolvedCredentials,
  ): Promise<{
    pagesPulled: number;
    ordersPersisted: number;
    syncComplete: boolean;
    hitPageCap: boolean;
  }> {
    clearTenantOrderCachePrefix(companyId);
    const maxPages = leafLinkOrdersFullSyncMaxPages();
    let pagesPulled = 0;
    let ordersPersisted = 0;

    const createdOnGteIso = cleanString(filters?.createdOnGteIso);
    const createdOnLteIso = cleanString(filters?.createdOnLteIso);

    const creds = reuseCreds ?? await this.leafLinkService.resolveRuntimeCredentials(companyId);
    if (!reuseCreds) {
      logInfo("[LEAFLINK] credentials_resolved", {
        companyId,
        authSource: creds.source,
        fromDb: creds.source === "db",
        fromEnv: creds.source === "env",
      });
    }
    if (!creds.integrationEnabled || !baseOutConfiguredForOrders(creds))
      return { pagesPulled: 0, ordersPersisted: 0, syncComplete: true, hitPageCap: false };

    await this.assertOrdersCapableOrThrow(creds);

    logInfo("[LEAFLINK] orders_full_sync_start", {
      companyId,
      maxPages,
      createdOnGteIso: createdOnGteIso || null,
      createdOnLteIso: createdOnLteIso || null,
    });

    for (let page = 1; page <= maxPages; page++) {
      const res = await this.fetchOrdersSummariesPageWithCreds(creds, {
        page,
        pageSize: 100,
        ordering: "-created_on",
        createdOnGteIso: createdOnGteIso || undefined,
        createdOnLteIso: createdOnLteIso || undefined,
      });

      if (!res.rows.length)
        return { pagesPulled, ordersPersisted, syncComplete: true, hitPageCap: false };

      pagesPulled += 1;
      await persistLeafLinkFetchedOrderPairs(companyId, res.rows, page);
      ordersPersisted += res.rows.length;

      if (pagesPulled % 25 === 0 || !res.hasNext) {
        logInfo("[LEAFLINK] orders_full_sync_progress", {
          companyId,
          pagesPulled,
          ordersPersisted,
          hasNext: res.hasNext,
        });
      }

      if (!res.hasNext) {
        logInfo("[LEAFLINK] orders_full_sync_complete", { companyId, pagesPulled, ordersPersisted });
        return { pagesPulled, ordersPersisted, syncComplete: true, hitPageCap: false };
      }
    }

    logWarn("[LEAFLINK] orders_full_sync_page_cap", { companyId, maxPages, ordersPersisted });
    return { pagesPulled: maxPages, ordersPersisted, syncComplete: false, hitPageCap: true };
  }

  /**
   * Aggregate wholesale orders in a UTC date range from **saved** DB rows (same pool as the Orders page when loaded from cache).
   * Pass `{ refresh: true }` to **full-catalog paginate** LeafLink (`orders-received` until done or page cap), upsert into the DB, then aggregate from rows in `dateFrom`–`dateTo` (ranges only affect analytics display, not what gets synced).
   * **No LeafLink CRM customer-status filter** — every stored order whose date falls in the range is counted.
   * Sample lines: LeafLink `is_sample`, product/listing sample signals, `frozen_data`, plus name/SKU/notes (see {@link isSampleLineItem}).
   */
  async getOrdersAnalytics(
    companyId: string,
    input: { dateFrom: string; dateTo: string; refresh?: boolean },
  ): Promise<OrdersAnalyticsDto> {
    const dateFrom = cleanString(input.dateFrom);
    const dateTo = cleanString(input.dateTo);
    const fromMs = parseUtcDateOnlyToMs(dateFrom, false);
    const toMs = parseUtcDateOnlyToMs(dateTo, true);

    const emptyMeta = (): Pick<
      OrdersAnalyticsDto,
      | "readFromDatabase"
      | "leafLinkRefreshRan"
      | "storedRowsInRange"
      | "storedSnapshotMaxUpdatedAt"
      | "filteredByLeafLinkCurrentCustomerStatus"
      | "leafLinkCurrentCustomerCount"
    > => ({
      readFromDatabase: true,
      leafLinkRefreshRan: Boolean(input.refresh),
      storedRowsInRange: 0,
      storedSnapshotMaxUpdatedAt: null,
      filteredByLeafLinkCurrentCustomerStatus: false,
      leafLinkCurrentCustomerCount: 0,
    });

    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
      throw new AppError("Invalid date range.", 400, "ORDERS_ANALYTICS_BAD_RANGE");
    }
    if ((toMs - fromMs) / 86_400_000 > MAX_ANALYTICS_RANGE_DAYS) {
      throw new AppError(`Date range cannot exceed ${MAX_ANALYTICS_RANGE_DAYS} days.`, 400, "ORDERS_ANALYTICS_RANGE_TOO_WIDE");
    }

    const creds = await this.leafLinkService.resolveRuntimeCredentials(companyId);
    logInfo("[LEAFLINK] credentials_resolved", {
      companyId,
      authSource: creds.source,
      fromDb: creds.source === "db",
      fromEnv: creds.source === "env",
    });
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
        minOrderTotal: 0,
        pagesScanned: 0,
        truncated: false,
        days: dayList,
        customers: [],
        qualifyingOrders: [],
        qualifyingOrdersTruncated: false,
        ...emptyMeta(),
      };
    }

    await this.assertOrdersCapableOrThrow(creds);

    const filteredByLeafLinkCurrentCustomerStatus = false;
    const leafLinkCurrentCustomerCount = 0;

    let pagesScanned = 0;
    let truncated = false;

    if (input.refresh) {
      const pulled = await this.pullLeafLinkOrdersReceivedToDb(companyId, undefined, creds);
      pagesScanned = pulled.pagesPulled;
      truncated = pulled.hitPageCap || !pulled.syncComplete;
    }

    const storedDbRange = await findLeafLinkStoredOrdersForCompanyInRange(companyId, {
      from: new Date(fromMs),
      to: new Date(toMs),
    });

    const seenIds = new Set(storedDbRange.map((r) => r.id));
    /** Repair path: payloads with missing persisted `createdOn` often still embed order dates — merge when in-range after parse. */
    /** Keeps analytics reads fast — wide ranges already hit indexed `createdOn`; repair is capped. */
    /** Widen repairs so analytics still sees legacy rows with missing `createdOn` after payloads improve with `leafLinkOrderCreatedIso`. */
    const nullRepairCap = Math.min(12_000, Math.max(2_800, storedDbRange.length * 35));
    const storedDbNullRepair = await findRecentLeafLinkStoredOrdersWithNullCreatedOn(companyId, nullRepairCap);

    function rowOrderMsFromPayload(pair: { raw: Record<string, unknown>; summary: LeafLinkOrderSummaryDto }): number | null {
      const iso = cleanString(pair.summary.createdAt) || leafLinkOrderCreatedIso(pair.raw);
      const ms = Date.parse(iso || "");
      return Number.isFinite(ms) ? ms : null;
    }

    const extraInRange = storedDbNullRepair.filter((r) => {
      if (seenIds.has(r.id)) return false;
      const pair = collectedPairFromStoredPayload(r.payload);
      if (!pair) return false;
      const ms = rowOrderMsFromPayload(pair);
      return ms != null && ms >= fromMs && ms <= toMs;
    });

    const storedDb = [...storedDbRange, ...extraInRange];

    const storedSnapshotMaxUpdatedAt =
      storedDb.reduce<Date | null>(
        (acc, r) => (!acc || r.updatedAt > acc ? r.updatedAt : acc),
        null,
      )?.toISOString() ?? null;

    const collected: { raw: Record<string, unknown>; summary: LeafLinkOrderSummaryDto }[] = [];
    for (const r of storedDb) {
      const pair = collectedPairFromStoredPayload(r.payload);
      if (pair)
        collected.push(pair);
    }

    type CustAgg = {
      label: string;
      lastPurchaseMs: number;
      lastOrderTotal: number;
      revenueByDay: number[];
      orderCountByDay: number[];
      sampleUnitsByDay: number[];
      orderTotalSum: number;
      sampleTypeUnits: Map<string, number>;
      sampleLineItems: OrdersAnalyticsSampleLineItemDto[];
    };

    const agg = new Map<string, CustAgg>();
    let qualifyingOrderCount = 0;
    const qualifyingOrdersFull: OrdersAnalyticsQualifyingOrderDto[] = [];

    /** All canonical LeafLink identifiers we can derive from one order payload (matches export columns like `LEAFLINK_CRM_RECORD_ID`). */
    function leafLinkOrderBuyerKeyCandidates(
      buyerRaw: Record<string, unknown>,
      summaryBuyerId: LeafLinkOrderSummaryDto["buyerCustomerId"],
    ): string[] {
      const nest = nestedOrderRecord(buyerRaw);
      const nests = nest && typeof nest === "object" ? [buyerRaw, asRecord(nest)] : [buyerRaw];

      const seen = new Set<string>();
      const out: string[] = [];
      const push = (rawId: unknown) => {
        const c = canonicalLeafLinkBuyerId(rawId);
        if (!c || seen.has(c)) return;
        seen.add(c);
        out.push(c);
      };

      push(summaryBuyerId);
      for (const rec of nests) {
        push(leafLinkBuyerCustomerId(rec));
        for (const c of canonicalIdsFromSellerRecord(rec))
          push(c);
      }

      const buyerBare = buyerRaw.buyer ?? (nest ? asRecord(nest).buyer : undefined);
      if (buyerBare != null && typeof buyerBare === "object" && !Array.isArray(buyerBare)) {
        const br = asRecord(buyerBare);
        for (const fn of LEAF_LINK_CUSTOMER_ID_FIELD_NAMES)
          push(br[fn]);
      }
      return out;
    }

    for (const { raw, summary: o } of collected) {
      let buyerKeys = leafLinkOrderBuyerKeyCandidates(raw, o.buyerCustomerId);
      if (!buyerKeys.length) {
        const oid = cleanString(o.id) || cleanString(o.orderNumber);
        if (!oid) continue;
        /** Orders without resolvable CRM / customer ids were previously dropped from analytics entirely. */
        buyerKeys = [`__missing_buyer__:${canonicalLeafLinkBuyerId(oid) || oid.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120)}`];
      }

      const buyerCanon = buyerKeys[0];

      const createdIsoAgg = cleanString(o.createdAt) || leafLinkOrderCreatedIso(raw);
      const t = Date.parse(createdIsoAgg || "");
      if (!Number.isFinite(t)) continue;
      const rawMoney = effectiveOrderTotalUsd(raw, o);
      const money = typeof rawMoney === "number" && Number.isFinite(rawMoney) ? Math.max(0, rawMoney) : 0;

      const day = utcDayKeyFromMs(t);
      const di = dayIndex.get(day);
      if (di === undefined) continue;

      qualifyingOrderCount++;
      const nmFromOrder = cleanString(o.customerName);
      const label =
        nmFromOrder
        || `Buyer ${buyerCanon.length > 10 ? `${buyerCanon.slice(0, 8)}…` : buyerCanon}`;
      const ck = customerSeriesKey(buyerCanon, label);

      qualifyingOrdersFull.push({
        orderId: cleanString(o.id) || cleanString(o.orderNumber),
        orderNumber: cleanString(o.orderNumber),
        customerKey: ck,
        createdAt: new Date(t).toISOString(),
        totalUsd: Math.round(money * 100) / 100,
      });

      let row = agg.get(ck);
      if (!row) {
        row = {
          label,
          lastPurchaseMs: t,
          lastOrderTotal: money,
          revenueByDay: Array.from({ length: nDays }, () => 0),
          orderCountByDay: Array.from({ length: nDays }, () => 0),
          sampleUnitsByDay: Array.from({ length: nDays }, () => 0),
          orderTotalSum: 0,
          sampleTypeUnits: new Map(),
          sampleLineItems: [],
        };
        agg.set(ck, row);
      }

      if (t >= row.lastPurchaseMs) {
        row.lastPurchaseMs = t;
        row.lastOrderTotal = money;
      }
      row.orderTotalSum += money;
      row.revenueByDay[di] += money;
      row.orderCountByDay[di] += 1;

      for (const li of o.lineItems) {
        if (!isSampleLineItem(li)) continue;
        const q = li.quantity > 0 ? li.quantity : 1;
        row.sampleUnitsByDay[di] += q;
        const tl = sampleTypeLabelForLine(li);
        row.sampleTypeUnits.set(tl, (row.sampleTypeUnits.get(tl) ?? 0) + q);
        row.sampleLineItems.push({
          orderId: cleanString(o.id) || cleanString(o.orderNumber),
          orderNumber: cleanString(o.orderNumber),
          createdAt: o.createdAt,
          productName: cleanString(li.productName) || "Unknown sample",
          sku: cleanString(li.sku),
          quantity: q,
          typeLabel: tl,
        });
      }
    }

    qualifyingOrdersFull.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    let qualifyingOrdersTruncated = false;
    let qualifyingOrders = qualifyingOrdersFull;
    if (qualifyingOrdersFull.length > MAX_QUALIFYING_ORDERS_IN_PAYLOAD) {
      qualifyingOrders = qualifyingOrdersFull.slice(0, MAX_QUALIFYING_ORDERS_IN_PAYLOAD);
      qualifyingOrdersTruncated = true;
    }

    const customers: OrdersAnalyticsCustomerDto[] = [...agg.entries()]
      .map(([key, v]) => ({
        key,
        label: v.label,
        lastPurchaseDate: new Date(v.lastPurchaseMs).toISOString(),
        lastOrderTotal: Math.round(v.lastOrderTotal * 100) / 100,
        orderTotalInRange: Math.round(v.orderTotalSum * 100) / 100,
        sampleUnitsInRange: [...v.sampleTypeUnits.values()].reduce((a, b) => a + b, 0),
        samplesByType: [...v.sampleTypeUnits.entries()]
          .map(([typeLabel, units]) => ({ typeLabel, units }))
          .sort((a, b) => b.units - a.units),
        sampleLineItems: v.sampleLineItems
          .slice()
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
        revenueByDay: v.revenueByDay.map((x) => Math.round(x * 100) / 100),
        orderCountByDay: v.orderCountByDay.map((x) => x),
        sampleUnitsByDay: v.sampleUnitsByDay.map((x) => x),
      }))
      .sort((a, b) => {
        const ah = a.orderTotalInRange > 0 ? 1 : 0;
        const bh = b.orderTotalInRange > 0 ? 1 : 0;
        if (ah !== bh)
          return bh - ah;
        const byRev = b.orderTotalInRange - a.orderTotalInRange;
        if (byRev !== 0)
          return byRev;
        return (a.label || "").localeCompare(b.label || "");
      });

    logInfo("[LEAFLINK] orders_analytics_done", {
      companyId,
      ordersIncluded: qualifyingOrderCount,
      pagesScanned,
      truncated,
      customerCount: customers.length,
      qualifyingOrdersReturned: qualifyingOrders.length,
      qualifyingOrdersTruncated,
      storedRowsInRange: storedDb.length,
      refresh: Boolean(input.refresh),
      leafLinkCurrentCustomerCount,
      filteredByLeafLinkCurrentCustomerStatus,
    });

    return {
      source: "leaflink",
      configured: true,
      integrationEnabled: true,
      dateFrom,
      dateTo,
      ordersIncluded: qualifyingOrderCount,
      minOrderTotal: 0,
      pagesScanned,
      truncated,
      days: dayList,
      customers,
      qualifyingOrders,
      qualifyingOrdersTruncated,
      readFromDatabase: true,
      leafLinkRefreshRan: Boolean(input.refresh),
      storedRowsInRange: storedDb.length,
      storedSnapshotMaxUpdatedAt,
      filteredByLeafLinkCurrentCustomerStatus,
      leafLinkCurrentCustomerCount,
    };
  }

  /** Pull paginated summaries (warm cache + bookkeeping). Does not overwrite inventory. */
  async syncOrdersWarm(companyId: string): Promise<LeafLinkOrdersSyncDto> {
    const creds = await this.leafLinkService.resolveRuntimeCredentials(companyId);
    logInfo("[LEAFLINK] credentials_resolved", {
      companyId,
      authSource: creds.source,
      fromDb: creds.source === "db",
      fromEnv: creds.source === "env",
    });
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

    const pulled = await this.pullLeafLinkOrdersReceivedToDb(companyId, undefined, creds);

    logInfo("[LEAFLINK] orders_sync_complete", {
      companyId,
      pages: pulled.pagesPulled,
      ordersSeen: pulled.ordersPersisted,
      syncComplete: pulled.syncComplete,
      hitPageCap: pulled.hitPageCap,
    });
    return {
      ok: true,
      configured: true,
      integrationEnabled: true,
      pagesPulled: pulled.pagesPulled,
      ordersSeen: pulled.ordersPersisted,
      syncComplete: pulled.syncComplete,
      hitPageCap: pulled.hitPageCap,
      lastFetchedAt: new Date().toISOString(),
    };
  }

  async findOpenPaymentCandidatesForCheck(
    companyId: string,
    input: { invoiceNumber?: string; payerName?: string; amount?: number },
  ): Promise<LeafLinkPaymentMatchCandidateDto[]> {
    const invoiceNeedle = cleanString(input.invoiceNumber).toLowerCase();
    const payerNeedle = cleanString(input.payerName).toLowerCase();
    const amountNeedle = typeof input.amount === "number" && Number.isFinite(input.amount) ? input.amount : null;
    const rows = await findRecentLeafLinkStoredOrdersForCompany(companyId, 4000);
    const out: LeafLinkPaymentMatchCandidateDto[] = [];
    for (const row of rows) {
      const pair = collectedPairFromStoredPayload(row.payload);
      if (!pair) continue;
      const summary = pair.summary;
      const statusNorm = cleanString(summary.statusNormalized || summary.status).toLowerCase();
      if (statusNorm.includes("cancel")) continue;
      const paid = summary.paid || cleanString(summary.paymentStatus).toLowerCase() === "paid";
      if (paid) continue;
      const orderNumber = cleanString(summary.orderNumber || summary.shortNumber || summary.id);
      const customerName = cleanString(summary.customerName);
      const total = typeof summary.total === "number" ? summary.total : orderTotalMoney(summary);
      const outstandingBalance = paid ? 0 : total;
      const matchedBy: string[] = [];
      let score = 0;
      if (invoiceNeedle) {
        const ordLower = orderNumber.toLowerCase();
        if (ordLower === invoiceNeedle) {
          matchedBy.push("invoice_exact");
          score += 100;
        } else if (ordLower.includes(invoiceNeedle) || invoiceNeedle.includes(ordLower)) {
          matchedBy.push("invoice_partial");
          score += 40;
        }
      }
      if (!matchedBy.includes("invoice_exact") && payerNeedle && customerName.toLowerCase().includes(payerNeedle)) {
        matchedBy.push("payee_name");
        score += 20;
      }
      if (amountNeedle != null) {
        const diffTotal = Math.abs(total - amountNeedle);
        const diffOutstanding = outstandingBalance == null ? Number.POSITIVE_INFINITY : Math.abs(outstandingBalance - amountNeedle);
        if (diffTotal <= 0.01 || diffOutstanding <= 0.01) {
          matchedBy.push("amount");
          score += 25;
        }
      }
      if (matchedBy.length === 0) continue;
      out.push({
        leafLinkKey: cleanString(summary.id) || cleanString(row.id) || orderNumber,
        orderId: summary.id,
        orderNumber,
        customerName,
        total,
        outstandingBalance,
        status: summary.statusNormalized || summary.status,
        paymentStatus: summary.paymentStatus,
        deliveryDate: summary.deliveryDate,
        lineItems: summary.lineItems,
        score,
        matchedBy,
      });
    }
    return out.sort((a, b) => b.score - a.score || a.orderNumber.localeCompare(b.orderNumber));
  }

  async postCheckPayment(
    companyId: string,
    input: { orderNumber: string; amount: number; paymentDateIso: string; note: string; reference?: string | null },
  ): Promise<{ paymentId: string; paymentStatus: string; rawResponse: unknown }> {
    const creds = await this.leafLinkService.resolveRuntimeCredentials(companyId);
    logInfo("[LEAFLINK] credentials_resolved", {
      companyId,
      authSource: creds.source,
      fromDb: creds.source === "db",
      fromEnv: creds.source === "env",
    });
    if (!creds.integrationEnabled || !creds.apiKey || (!creds.companyId && !creds.companySlug)) {
      throw new AppError("LeafLink is not configured.", 400, "LEAFLINK_MISSING_CONFIG");
    }
    await this.assertOrdersCapableOrThrow(creds);
    const base = creds.baseUrl.replace(/\/+$/, "");
    const orderNumEsc = encodeURIComponent(cleanString(input.orderNumber));
    const urls: string[] = [];
    if (creds.companyId) {
      urls.push(`${base}/v2/companies/${encodeURIComponent(creds.companyId)}/orders-received/${orderNumEsc}/payments/`);
      urls.push(`${base}/v2/companies/${encodeURIComponent(creds.companyId)}/order-payments/`);
    }
    urls.push(`${base}/v2/orders-received/${orderNumEsc}/payments/`);
    urls.push(`${base}/v2/order-payments/`);
    const payloads: Record<string, unknown>[] = [
      {
        order_number: input.orderNumber,
        amount: input.amount,
        payment_method: "Check",
        payment_date: input.paymentDateIso,
        reference: cleanString(input.reference),
        notes: input.note,
      },
      {
        order: input.orderNumber,
        amount: input.amount,
        payment_method: "Check",
        date: input.paymentDateIso,
        reference: cleanString(input.reference),
        notes: input.note,
      },
    ];
    let lastErr: unknown;
    for (const payload of payloads) {
      try {
        const { body } = await leafLinkAuthedRequest(urls, creds, creds.source, 25_000, "POST", payload);
        const rec = asRecord(body);
        const paymentId = cleanString(rec.id || rec.payment_id || rec.uuid || rec.reference || rec.order_payment_id) || `leaflink-${Date.now()}`;
        const paymentStatus = cleanString(rec.status || rec.payment_status || rec.state) || "posted";
        return { paymentId, paymentStatus, rawResponse: body };
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr instanceof AppError) throw lastErr;
    throw new AppError("LeafLink payment post failed.", 502, "LEAFLINK_PAYMENT_POST_FAILED");
  }
}

function baseOutConfiguredForOrders(creds: LeafLinkRuntimeCredentials): boolean {
  return Boolean(creds.apiKey && (creds.companyId || creds.companySlug));
}
