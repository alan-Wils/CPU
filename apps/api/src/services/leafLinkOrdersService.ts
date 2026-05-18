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
  findRecentLeafLinkStoredOrdersForCompany,
  findRecentLeafLinkStoredOrdersWithNullCreatedOn,
  STORED_ORDER_FETCH_HARD_CAP,
  type LeafLinkStoredOrderUpsertInput,
  type LeafLinkStoredOrderUpsertStats,
} from "./leafLinkOrdersStorePrimitives.js";
import {
  acquireLeafLinkOrdersSyncLock,
  getLeafLinkOrdersSyncState,
  recordLeafLinkOrdersSyncRun,
  releaseLeafLinkOrdersSyncLock,
  type LeafLinkOrdersSyncCursor,
} from "./leafLinkOrdersSyncStateService.js";

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

/** First strictly-positive money field on a LeafLink order-ish record (list/detail shapes vary). */
function firstPositiveMoneyInRecord(rec: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const k of keys) {
    const m = moneyAmount(rec[k]);
    if (m != null && m > 0) return m;
  }
  return null;
}

const LEAFLINK_ORDER_TOTAL_FIELDS = [
  "total",
  "grand_total",
  "final_total",
  "order_total",
  "total_amount",
  "invoice_total",
  "amount_due",
  "order_amount",
  "total_cost",
  "amount",
] as const;

const LEAFLINK_ORDER_SUBTOTAL_FIELDS = [
  "subtotal",
  "order_subtotal",
  "sub_total",
  "sub_total_amount",
  "merchandise_total",
] as const;

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
  /** True when stopping only because the page cap was reached. */
  hitPageCap?: boolean;
  skipped?: boolean;
  reason?: string;
  mode?: "incremental" | "manual_full_rebuild";
  rowsCreated?: number;
  rowsUpdated?: number;
  rowsSkippedUnchanged?: number;
  stoppedReason?: string;
  durationMs?: number;
  cutoffIso?: string | null;
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
  /** Orders in this snapshot in the selected UTC range after LeafLink-aligned filters (excludes draft/cancelled/void; headline count matches KPI totals). */
  ordersIncluded: number;
  /** Always 0 — no minimum order filter in analytics. Present for backwards-compatible clients. */
  minOrderTotal: number;
  pagesScanned: number;
  truncated: boolean;
  days: string[];
  /** Buyers present on stored orders in this snapshot. */
  customers: OrdersAnalyticsCustomerDto[];
  /** One row per order for scatter chart. May be truncated — see `qualifyingOrdersTruncated`. */
  qualifyingOrders: OrdersAnalyticsQualifyingOrderDto[];
  qualifyingOrdersTruncated: boolean;
  /** Sum of `totalUsd` over every qualifying order in range (not truncated). Use for KPI totals when `qualifyingOrders` is sliced. */
  qualifyingRevenueTotalUsd: number;
  /** Series are built from saved orders (see persisted rows when Orders / sync runs). */
  readFromDatabase: boolean;
  /** This request refreshed LeafLink into the DB before aggregating (`refresh=true`). */
  leafLinkRefreshRan: boolean;
  /** Stored wholesale rows considered for this report (padded `createdOn` fetch + null-created + repair); strict totals filter by payload placed instant. */
  storedRowsInRange: number;
  /** All `LeafLinkStoredOrder` rows for this company (same pool as Orders page cache). */
  totalStoredOrders: number;
  /** Latest `updatedAt` among rows read for this range (`null` if none). */
  storedSnapshotMaxUpdatedAt: string | null;
  /** Daily chart axis truncated to the most recent slice when history exceeds server cap (totals still include all saved orders). */
  chartDaysCapped: boolean;
  /** Legacy field — analytics no longer gates on LeafLink CRM customer status (always false / 0). */
  filteredByLeafLinkCurrentCustomerStatus: boolean;
  leafLinkCurrentCustomerCount: number;
  /** Set when no stored orders exist for the company/range — client should not auto-sync. */
  noCachedMessage?: string | null;
};

/** @deprecated Range filters removed — retained for docs. Chart axis length is capped separately. */
const MAX_ANALYTICS_RANGE_DAYS = 366;
/** Max UTC days in daily chart arrays when history is long (totals still use every order). */
const MAX_ANALYTICS_CHART_DAYS = 8000;
/** Manual full rebuild only (`LEAFLINK_ORDERS_FULL_SYNC_MAX_PAGES`). */
const DEFAULT_LEAF_LINK_FULL_SYNC_MAX_PAGES = 5000;
const ABS_LEAF_LINK_FULL_SYNC_MAX_PAGES = 50_000;
/** Incremental warm sync defaults (override via env). */
const DEFAULT_LEAF_LINK_SYNC_LOOKBACK_DAYS = 90;
const DEFAULT_LEAF_LINK_SYNC_MAX_PAGES = 25;
const DEFAULT_LEAF_LINK_SYNC_MAX_ROWS = 2500;
const ABS_LEAF_LINK_SYNC_MAX_PAGES = 200;
const ABS_LEAF_LINK_SYNC_MAX_ROWS = 10_000;
/** Cap per-order rows returned for scatter/detail; raise with care (payload size). */
const MAX_QUALIFYING_ORDERS_IN_PAYLOAD = 8000;
/** If list payload embeds many line rows, summing them is often wrong vs order headline `total`. */
const MAX_LINE_ITEMS_TO_TRUST_SUM = 120;
/** Max Postgres rows hydrated for the Orders list when `refresh=false`. Must stay ≤ prisma cap in leafLinkOrdersStorePrimitives. */
const STORED_ORDERS_LIST_SCAN_LIMIT = 25_000;
const preferredLeafLinkAuthByTenant = new Map<string, string>();

/** User-entered invoice field may list several refs separated by comma, semicolon, or newline. */
export function splitInvoiceNumberTokens(raw: string | undefined): string[] {
  if (!raw) return [];
  return String(raw)
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function invoiceDigitsOnly(s: string): string {
  return String(s || "").replace(/\D/g, "");
}

/** Last `n` digits from the order # / id string (for matching invoice stubs to e.g. …9511). */
function orderTailDigits(orderNumber: string, n: number): string {
  const d = invoiceDigitsOnly(orderNumber);
  return d.length >= n ? d.slice(-n) : d;
}

function leafLinkOrdersFullSyncMaxPages(): number {
  const raw = String(process.env.LEAFLINK_ORDERS_FULL_SYNC_MAX_PAGES ?? "").trim();
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_LEAF_LINK_FULL_SYNC_MAX_PAGES;
  if (!Number.isFinite(n) || n < 1)
    return DEFAULT_LEAF_LINK_FULL_SYNC_MAX_PAGES;
  return Math.min(Math.floor(n), ABS_LEAF_LINK_FULL_SYNC_MAX_PAGES);
}

function leafLinkOrderSyncLookbackDays(): number {
  const raw = String(process.env.LEAFLINK_ORDER_SYNC_LOOKBACK_DAYS ?? "").trim();
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_LEAF_LINK_SYNC_LOOKBACK_DAYS;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LEAF_LINK_SYNC_LOOKBACK_DAYS;
  return Math.min(Math.floor(n), 3660);
}

function leafLinkOrderSyncMaxPages(): number {
  const raw = String(process.env.LEAFLINK_ORDER_SYNC_MAX_PAGES ?? "").trim();
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_LEAF_LINK_SYNC_MAX_PAGES;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LEAF_LINK_SYNC_MAX_PAGES;
  return Math.min(Math.floor(n), ABS_LEAF_LINK_SYNC_MAX_PAGES);
}

function leafLinkOrderSyncMaxRows(): number {
  const raw = String(process.env.LEAFLINK_ORDER_SYNC_MAX_ROWS ?? "").trim();
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_LEAF_LINK_SYNC_MAX_ROWS;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LEAF_LINK_SYNC_MAX_ROWS;
  return Math.min(Math.floor(n), ABS_LEAF_LINK_SYNC_MAX_ROWS);
}

function leafLinkSyncDebugEnabled(): boolean {
  return String(process.env.LEAFLINK_SYNC_DEBUG ?? "").trim().toLowerCase() === "true";
}

function lookbackCutoffIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function orderInstantMs(summary: LeafLinkOrderSummaryDto): number {
  const u = Date.parse(summary.updatedAt || "");
  if (Number.isFinite(u)) return u;
  const c = Date.parse(summary.createdAt || "");
  return Number.isFinite(c) ? c : 0;
}

function orderCreatedMs(summary: LeafLinkOrderSummaryDto): number {
  const c = Date.parse(summary.createdAt || "");
  return Number.isFinite(c) ? c : 0;
}

function pageAllOrdersOlderThanCutoff(
  rows: { summary: LeafLinkOrderSummaryDto }[],
  cutoffMs: number,
): boolean {
  if (!rows.length) return true;
  return rows.every((r) => orderCreatedMs(r.summary) < cutoffMs && orderInstantMs(r.summary) < cutoffMs);
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
 * All parseable order timestamps from a stored wholesale payload (deduped). Order matches {@link leafLinkOrderCreatedIso} priority for the first element.
 */
function collectLeafLinkOrderTimestampIsos(row: Record<string, unknown>): string[] {
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
    row.submit_date,
    row.order_submitted_date,
    row.inserted_at,
    nest.created_on,
    nest.created_at,
    nest.created,
    nest.order_date,
    nest.order_date_datetime,
    nest.date_ordered,
    nest.submitted_on,
    nest.submitted_at,
    nest.submitted_date,
    nest.submit_date,
    nest.order_submitted_date,
    nest.timestamp,
    nest.placed_at,
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    const iso = fieldIsoDate(k);
    if (!iso || seen.has(iso)) continue;
    seen.add(iso);
    out.push(iso);
  }
  return out;
}

/**
 * Wholesale order payloads differ by endpoint; normalize created timestamps so DB range queries & analytics UTC bucketing agree.
 */
function leafLinkOrderCreatedIso(row: Record<string, unknown>): string {
  const all = collectLeafLinkOrderTimestampIsos(row);
  return all[0] ?? "";
}

/** LeafLink sales KPIs omit draft / void / cancelled — align stored-order analytics the same way. */
function isExcludedFromLeafLinkSalesKpi(o: LeafLinkOrderSummaryDto): boolean {
  const norm = cleanString(o.statusNormalized).toLowerCase();
  if (norm === "cancelled" || norm === "draft") return true;
  const s = cleanString(o.status).toLowerCase();
  if (s.includes("void") || s.includes("cancel")) return true;
  if (s === "draft") return true;
  return false;
}

/**
 * If any of summary / payload timestamps fall in `[fromMs, toMs]`, returns the latest such instant (UTC). Matches LeafLink-style “in period” when submit vs create differ.
 */
function orderChosenInstantMsForUtcRange(
  raw: Record<string, unknown>,
  o: LeafLinkOrderSummaryDto,
  fromMs: number,
  toMs: number,
): number | null {
  const seenIso = new Set<string>();
  const timesMs: number[] = [];
  const addIso = (iso: string) => {
    const s = cleanString(iso);
    if (!s || seenIso.has(s)) return;
    seenIso.add(s);
    const t = Date.parse(s);
    if (Number.isFinite(t)) timesMs.push(t);
  };
  addIso(cleanString(o.createdAt) || "");
  for (const iso of collectLeafLinkOrderTimestampIsos(raw)) addIso(iso);
  let best: number | null = null;
  for (const t of timesMs) {
    if (t < fromMs || t > toMs) continue;
    if (best == null || t > best) best = t;
  }
  return best;
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
    firstPositiveMoneyInRecord(raw, LEAFLINK_ORDER_TOTAL_FIELDS)
    ?? firstPositiveMoneyInRecord(nest, LEAFLINK_ORDER_TOTAL_FIELDS);

  const lines = summary.lineItems;
  const linesSum = lines.reduce((acc, li) => acc + (li.lineTotal ?? 0), 0);
  const lineCount = lines.length;

  const rawSub =
    firstPositiveMoneyInRecord(raw, LEAFLINK_ORDER_SUBTOTAL_FIELDS)
    ?? firstPositiveMoneyInRecord(nest, LEAFLINK_ORDER_SUBTOTAL_FIELDS);

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
  const nest =
    raw.order != null && typeof raw.order === "object" && !Array.isArray(raw.order)
      ? asRecord(raw.order)
      : {};
  const top = Array.isArray(raw.line_items) ? raw.line_items : [];
  const nested = Array.isArray(nest.line_items) ? nest.line_items : [];
  /** List payloads often nest line rows only under `order`; pick whichever side has rows (prefer longer). */
  const arr = nested.length > top.length ? nested : top;
  if (!Array.isArray(arr) || arr.length === 0) return [];
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
    let lineTotal: number | null =
      moneyAmount(r.total)
      ?? moneyAmount(r.line_total)
      ?? moneyAmount(r.extended_price)
      ?? moneyAmount(r.subtotal)
      ?? moneyAmount(r.amount);
    if (lineTotal == null && unitPrice != null && qty > 0) lineTotal = unitPrice * qty;

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
  let subtotal: number | null =
    firstPositiveMoneyInRecord(row, LEAFLINK_ORDER_SUBTOTAL_FIELDS)
    ?? firstPositiveMoneyInRecord(nestedOrder, LEAFLINK_ORDER_SUBTOTAL_FIELDS);
  if (subtotal == null && lineItems.length) {
    const sum = lineItems.reduce((acc, x) => acc + (x.lineTotal ?? 0), 0);
    subtotal = sum > 0 ? sum : null;
  }

  const total =
    firstPositiveMoneyInRecord(row, LEAFLINK_ORDER_TOTAL_FIELDS)
    ?? firstPositiveMoneyInRecord(nestedOrder, LEAFLINK_ORDER_TOTAL_FIELDS);
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
  /** True when the cached LeafLink order is already paid (only returned by {@link findPaymentMatchCandidatesIncludingPaidForCheck}). */
  markedPaidInLeafLink: boolean;
};

/** API shape for check/cash list “LeafLink invoice” column (see admin `LeafLinkInvoiceLineStatus`). */
export type LeafLinkInvoiceLineStatusDto = {
  hasInvoiceTokens: boolean;
  matchedOrderNumber: string | null;
  matchedOrderId: string | null;
  markedPaidInLeafLink: boolean;
  outstandingBalance: number | null;
  paymentStatus: string | null;
  summary: string;
};

type LeafLinkStoredOrderScanRow = {
  id: string;
  leafLinkKey: string;
  totalUsd: number | null;
  payload: unknown;
};

function collectLeafLinkPaymentCandidatesFromDbRows(
  rows: LeafLinkStoredOrderScanRow[],
  input: { invoiceNumber?: string; payerName?: string; amount?: number },
  opts: { includePaid: boolean },
): LeafLinkPaymentMatchCandidateDto[] {
  const invoiceTokens = splitInvoiceNumberTokens(input.invoiceNumber);
  const payerNeedle = cleanString(input.payerName).toLowerCase();
  const amountNeedle = typeof input.amount === "number" && Number.isFinite(input.amount) ? input.amount : null;
  const out: LeafLinkPaymentMatchCandidateDto[] = [];
  for (const row of rows) {
    const pair = collectedPairFromStoredPayload(row.payload);
    if (!pair) continue;
    const summary = pair.summary;
    const statusNorm = cleanString(summary.statusNormalized || summary.status).toLowerCase();
    if (statusNorm.includes("cancel")) continue;
    const paid = summary.paid || cleanString(summary.paymentStatus).toLowerCase() === "paid";
    if (paid && !opts.includePaid) continue;
    const orderNumber = cleanString(summary.orderNumber || summary.shortNumber || summary.id);
    const customerName = cleanString(summary.customerName);
    const total = typeof summary.total === "number" ? summary.total : orderTotalMoney(summary);
    const outstandingBalance = paid ? 0 : total;
    const matchedBySet = new Set<string>();
    let score = 0;

    if (invoiceTokens.length > 0) {
      for (const rawTok of invoiceTokens) {
        const tok = cleanString(rawTok);
        if (!tok) continue;
        const ordLower = orderNumber.toLowerCase();
        const tokLower = tok.toLowerCase();
        const tokDigits = invoiceDigitsOnly(tok);
        const ordTail4 = orderTailDigits(orderNumber, 4);
        const normOrd = ordLower.replace(/^#/, "");
        const normTok = tokLower.replace(/^#/, "");
        if (normOrd === normTok || ordLower === tokLower) {
          matchedBySet.add("invoice_exact");
          score += 100;
        }
        else if (tokDigits.length >= 4 && ordTail4.length >= 4 && tokDigits.slice(-4) === ordTail4) {
          matchedBySet.add("invoice_last4");
          score += 95;
        }
        else if (normOrd.includes(normTok) || normTok.includes(normOrd)) {
          matchedBySet.add("invoice_partial");
          score += 40;
        }
      }
    }

    if (!matchedBySet.has("invoice_exact") && payerNeedle && customerName.toLowerCase().includes(payerNeedle)) {
      matchedBySet.add("payee_name");
      score += 20;
    }
    if (amountNeedle != null) {
      const diffTotal = Math.abs(total - amountNeedle);
      const diffOutstanding =
        outstandingBalance == null ? Number.POSITIVE_INFINITY : Math.abs(outstandingBalance - amountNeedle);
      if (diffTotal <= 0.01 || diffOutstanding <= 0.01) {
        matchedBySet.add("amount");
        score += 25;
      }
    }
    if (matchedBySet.size === 0) continue;
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
      matchedBy: [...matchedBySet],
      markedPaidInLeafLink: paid,
    });
  }
  return out.sort((a, b) => b.score - a.score || a.orderNumber.localeCompare(b.orderNumber));
}

/**
 * Best-effort LeafLink order state for a check/cash row using only **saved** `leafLinkStoredOrder` payloads
 * (same scan cap as matching — no live LeafLink call).
 */
export function summarizeLeafLinkInvoiceFromStoredRows(
  storedRows: LeafLinkStoredOrderScanRow[],
  input: { invoiceNumber?: string | null; payerName?: string | null; amount: number | null },
): LeafLinkInvoiceLineStatusDto {
  const invoiceTokens = splitInvoiceNumberTokens(input.invoiceNumber ?? undefined);
  const hasInvoiceTokens = invoiceTokens.length > 0;
  if (!hasInvoiceTokens) {
    return {
      hasInvoiceTokens: false,
      matchedOrderNumber: null,
      matchedOrderId: null,
      markedPaidInLeafLink: false,
      outstandingBalance: null,
      paymentStatus: null,
      summary: "",
    };
  }
  const narrow = {
    invoiceNumber: input.invoiceNumber ?? undefined,
    payerName: input.payerName ?? undefined,
    amount: input.amount == null || !Number.isFinite(input.amount) ? undefined : input.amount,
  };
  const candidates = collectLeafLinkPaymentCandidatesFromDbRows(storedRows, narrow, { includePaid: true });
  if (!candidates.length) {
    return {
      hasInvoiceTokens: true,
      matchedOrderNumber: null,
      matchedOrderId: null,
      markedPaidInLeafLink: false,
      outstandingBalance: null,
      paymentStatus: null,
      summary: "No matching LeafLink order in saved cache — refresh Orders / multi-page sync.",
    };
  }
  const best = candidates[0];
  const summary = `${best.customerName} · #${best.orderNumber} · ${best.paymentStatus} (match ${best.matchedBy.join(", ")})`;
  return {
    hasInvoiceTokens: true,
    matchedOrderNumber: best.orderNumber,
    matchedOrderId: best.orderId,
    markedPaidInLeafLink: best.markedPaidInLeafLink,
    outstandingBalance: best.outstandingBalance,
    paymentStatus: best.paymentStatus,
    summary,
  };
}

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
): Promise<LeafLinkStoredOrderUpsertStats> {
  const empty: LeafLinkStoredOrderUpsertStats = { created: 0, updated: 0, skippedUnchanged: 0 };
  const cid = cleanString(companyId);
  if (!cid || !Array.isArray(apiRows) || apiRows.length === 0)
    return empty;
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
    if (!inputs.length) return empty;
    const stats = await upsertLeafLinkStoredOrders(cid, inputs);
    if (leafLinkSyncDebugEnabled()) {
      logInfo("[LEAFLINK] orders_saved_to_db", { companyId: cid, rows: inputs.length, sourcePage, ...stats });
    }
    return stats;
  }
  catch (err) {
    logWarn("[LEAFLINK] orders_save_to_db_failed", { err: err instanceof Error ? err.message : String(err) });
    return empty;
  }
}

async function persistLeafLinkFetchedOrderPairs(
  companyId: string,
  pairs: { raw: Record<string, unknown>; summary: LeafLinkOrderSummaryDto }[],
  sourcePage?: number,
): Promise<LeafLinkStoredOrderUpsertStats> {
  const empty: LeafLinkStoredOrderUpsertStats = { created: 0, updated: 0, skippedUnchanged: 0 };
  const cid = cleanString(companyId);
  if (!cid || !pairs.length) return empty;
  try {
    const inputs: LeafLinkStoredOrderUpsertInput[] = [];
    for (const { raw, summary } of pairs) {
      const row = toUpsertInputFromLeafLinkPayload(raw, summary, sourcePage ?? null);
      if (row) inputs.push(row);
    }
    if (!inputs.length) return empty;
    const stats = await upsertLeafLinkStoredOrders(cid, inputs);
    if (leafLinkSyncDebugEnabled()) {
      logInfo("[LEAFLINK] orders_saved_to_db_pairs", { companyId: cid, rows: inputs.length, sourcePage, ...stats });
    }
    return stats;
  }
  catch (err) {
    logWarn("[LEAFLINK] orders_save_pairs_failed", { err: err instanceof Error ? err.message : String(err) });
    return empty;
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
        if (leafLinkSyncDebugEnabled()) {
          logInfo("[LEAFLINK] orders_request", {
            url: url.slice(0, 200),
            authMode,
            authSource,
            companyId: creds.companyId || null,
          });
        }
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

/** In-process cache: resolved LeafLink `company-staff` id used as `recorded_by` on payments. */
const paymentRecorderStaffIdCache = new Map<string, number>();

function companyStaffRowsFromBody(body: unknown): Record<string, unknown>[] {
  const root = asRecord(body);
  if (Array.isArray(root.results)) {
    return root.results.filter(
      (x): x is Record<string, unknown> =>
        x != null && typeof x === "object" && !Array.isArray(x),
    ) as Record<string, unknown>[];
  }
  if (Array.isArray(body)) {
    return body.filter(
      (x): x is Record<string, unknown> =>
        x != null && typeof x === "object" && !Array.isArray(x),
    ) as Record<string, unknown>[];
  }
  return [];
}

function pickRecorderStaffIdFromList(rows: Record<string, unknown>[]): number | null {
  const active = rows.filter((r) => r.is_active !== false);
  const admins = active.filter((r) => r.is_admin === true);
  const pool = admins.length ? admins : active;
  for (const r of pool) {
    const id = toNumber(r.id);
    if (id > 0) return Math.trunc(id);
  }
  return null;
}

async function fetchFirstCompanyStaffRecorderId(
  creds: LeafLinkRuntimeCredentials,
  authSource: LeafLinkCredentialSource,
): Promise<number | null> {
  const base = creds.baseUrl.replace(/\/+$/, "");
  const qs = new URLSearchParams({ is_active: "true", limit: "50" });
  if (creds.companyId)
    qs.set("company", creds.companyId);
  else if (creds.companySlug)
    qs.set("company_slug", creds.companySlug);
  const qStr = qs.toString();
  const urls: string[] = [];
  if (creds.companyId) {
    urls.push(
      `${base}/v2/companies/${encodeURIComponent(creds.companyId)}/company-staff/?${qStr}`,
    );
  }
  urls.push(`${base}/v2/company-staff/?${qStr}`);
  const seen = new Set<string>();
  const uniq = urls.filter((u) => {
    if (!u || seen.has(u)) return false;
    seen.add(u);
    return true;
  });
  try {
    const { body } = await leafLinkAuthedGet(uniq, creds, authSource, 15_000);
    return pickRecorderStaffIdFromList(companyStaffRowsFromBody(body));
  }
  catch {
    return null;
  }
}

async function resolvePaymentRecorderStaffId(
  leafLinkService: LeafLinkService,
  companyId: string,
  creds: LeafLinkResolvedCredentials,
  authSource: LeafLinkCredentialSource,
): Promise<number> {
  const cacheKey = `${authTenantKey(creds)}|paymentRecorder`;
  const cached = paymentRecorderStaffIdCache.get(cacheKey);
  if (cached != null && cached > 0)
    return cached;

  const fromCfg = await leafLinkService.getRecordedByStaffIdFromConfig(companyId);
  if (fromCfg != null && fromCfg > 0) {
    paymentRecorderStaffIdCache.set(cacheKey, fromCfg);
    return fromCfg;
  }

  const envRaw = cleanString(process.env.LEAFLINK_RECORDED_BY_STAFF_ID);
  if (envRaw) {
    const n = Number.parseInt(envRaw, 10);
    if (Number.isFinite(n) && n > 0) {
      paymentRecorderStaffIdCache.set(cacheKey, n);
      return n;
    }
  }

  const fetched = await fetchFirstCompanyStaffRecorderId(creds, authSource);
  if (fetched != null && fetched > 0) {
    paymentRecorderStaffIdCache.set(cacheKey, fetched);
    return fetched;
  }

  throw new AppError(
    "LeafLink order payments require `recorded_by` (a company staff id). Set “Payment recorder (staff id)” in Admin → LeafLink, set env LEAFLINK_RECORDED_BY_STAFF_ID, or grant the API token permission to list GET /v2/company-staff/.",
    400,
    "LEAFLINK_PAYMENT_RECORDER_REQUIRED",
  );
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

  /**
   * Orders list — **Neon cache only**. Never calls LeafLink during normal page loads.
   * Use `POST /api/orders/sync` for incremental refresh.
   */
  async listOrders(
    companyId: string,
    input: {
      page: number;
      pageSize: number;
      status?: string;
      ordering?: string;
      /** Ignored for LeafLink API (reloads cache only). Kept for client compatibility. */
      refresh?: boolean;
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
        fromCache: true,
      };
    }

    const cached = await this.listOrdersFromStored(companyId, input, baseOut);
    if (cached) return cached;

    return {
      ...baseOut,
      orders: [],
      totalCount: 0,
      hasNext: false,
      hasPrevious: false,
      lastFetchedAt: nowIso,
      fromCache: true,
    };
  }

  async getOrdersSyncStatus(companyId: string) {
    return getLeafLinkOrdersSyncState(companyId);
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
   * Paginate LeafLink `orders-received` sequentially from page 1 (newest first).
   * Incremental mode applies lookback + row/page caps; full rebuild uses a separate higher page cap.
   */
  async pullLeafLinkOrdersReceivedToDb(
    companyId: string,
    opts: {
      mode: "incremental" | "manual_full_rebuild";
      filters?: PullLeafLinkOrdersReceivedOpts;
      reuseCreds?: LeafLinkResolvedCredentials;
    },
  ): Promise<{
    pagesPulled: number;
    ordersPersisted: number;
    rowsFetched: number;
    syncComplete: boolean;
    hitPageCap: boolean;
    hitRowCap: boolean;
    stoppedReason: string;
    rowsCreated: number;
    rowsUpdated: number;
    rowsSkippedUnchanged: number;
    cutoffIso: string | null;
    cursor: LeafLinkOrdersSyncCursor | null;
  }> {
    clearTenantOrderCachePrefix(companyId);
    const isIncremental = opts.mode === "incremental";
    const maxPages = isIncremental ? leafLinkOrderSyncMaxPages() : leafLinkOrdersFullSyncMaxPages();
    const maxRows = isIncremental ? leafLinkOrderSyncMaxRows() : Number.MAX_SAFE_INTEGER;
    const lookbackDays = leafLinkOrderSyncLookbackDays();
    const cutoffIso = isIncremental ? lookbackCutoffIso(lookbackDays) : null;
    const cutoffMs = cutoffIso ? Date.parse(cutoffIso) : 0;

    let pagesPulled = 0;
    let ordersPersisted = 0;
    let rowsFetched = 0;
    let rowsCreated = 0;
    let rowsUpdated = 0;
    let rowsSkippedUnchanged = 0;
    let stoppedReason = "complete";
    let hitRowCap = false;
    let hitPageCap = false;
    let latestCreated: string | null = null;
    let latestUpdated: string | null = null;

    const createdOnGteIso =
      cleanString(opts.filters?.createdOnGteIso)
      || (isIncremental && cutoffIso ? cutoffIso : "");
    const createdOnLteIso = cleanString(opts.filters?.createdOnLteIso);

    const creds = opts.reuseCreds ?? await this.leafLinkService.resolveRuntimeCredentials(companyId);
    if (!opts.reuseCreds) {
      logInfo("[LEAFLINK] credentials_resolved", {
        companyId,
        authSource: creds.source,
        fromDb: creds.source === "db",
        fromEnv: creds.source === "env",
      });
    }
    if (!creds.integrationEnabled || !baseOutConfiguredForOrders(creds)) {
      return {
        pagesPulled: 0,
        ordersPersisted: 0,
        rowsFetched: 0,
        syncComplete: true,
        hitPageCap: false,
        hitRowCap: false,
        stoppedReason: "not_configured",
        rowsCreated: 0,
        rowsUpdated: 0,
        rowsSkippedUnchanged: 0,
        cutoffIso,
        cursor: null,
      };
    }

    await this.assertOrdersCapableOrThrow(creds);

    const logTag = isIncremental ? "orders_incremental_sync" : "manual_full_rebuild";
    logInfo(`[LEAFLINK] ${logTag}_started`, {
      companyId,
      mode: opts.mode,
      maxPages,
      maxRows: isIncremental ? maxRows : null,
      cutoffIso,
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

      if (leafLinkSyncDebugEnabled()) {
        logInfo(`[LEAFLINK] ${logTag}_page`, {
          companyId,
          page,
          rowCount: res.rows.length,
          hasNext: res.hasNext,
        });
      }

      if (!res.rows.length) {
        stoppedReason = "empty_page";
        break;
      }

      rowsFetched += res.rows.length;
      pagesPulled += 1;

      for (const { summary } of res.rows) {
        const c = cleanString(summary.createdAt);
        const u = cleanString(summary.updatedAt);
        if (c && (!latestCreated || c > latestCreated)) latestCreated = c;
        if (u && (!latestUpdated || u > latestUpdated)) latestUpdated = u;
      }

      const stats = await persistLeafLinkFetchedOrderPairs(companyId, res.rows, page);
      rowsCreated += stats.created;
      rowsUpdated += stats.updated;
      rowsSkippedUnchanged += stats.skippedUnchanged;
      ordersPersisted += stats.created + stats.updated;

      if (isIncremental && cutoffMs > 0 && pageAllOrdersOlderThanCutoff(res.rows, cutoffMs)) {
        stoppedReason = "cutoff_reached";
        break;
      }

      if (ordersPersisted >= maxRows) {
        hitRowCap = true;
        stoppedReason = "row_cap";
        break;
      }

      if (!res.hasNext) {
        stoppedReason = "no_next_page";
        break;
      }
    }

    if (pagesPulled >= maxPages && stoppedReason !== "cutoff_reached" && stoppedReason !== "no_next_page" && stoppedReason !== "empty_page") {
      hitPageCap = true;
      stoppedReason = "page_cap";
      if (!isIncremental) {
        logWarn("[LEAFLINK] manual_full_rebuild_page_cap", { companyId, maxPages, ordersPersisted });
      }
    }

    const syncComplete = !hitPageCap && !hitRowCap && (stoppedReason === "no_next_page" || stoppedReason === "empty_page" || stoppedReason === "cutoff_reached");

    logInfo(`[LEAFLINK] ${logTag}_finished`, {
      companyId,
      mode: opts.mode,
      pagesPulled,
      rowsFetched,
      rowsCreated,
      rowsUpdated,
      rowsSkippedUnchanged,
      ordersPersisted,
      stoppedReason,
      syncComplete,
      hitPageCap,
      hitRowCap,
      cutoffIso,
    });

    return {
      pagesPulled,
      ordersPersisted,
      rowsFetched,
      syncComplete,
      hitPageCap,
      hitRowCap,
      stoppedReason,
      rowsCreated,
      rowsUpdated,
      rowsSkippedUnchanged,
      cutoffIso,
      cursor: {
        lastLeafLinkOrderCreatedAt: latestCreated,
        lastLeafLinkOrderUpdatedAt: latestUpdated,
      },
    };
  }

  /**
   * Aggregate wholesale orders for a **UTC date range** from **saved** DB rows only.
   * Hydrates with a **padded `createdOn` window** (DB timestamps can skew from LeafLink payload “placed” time),
   * merges `createdOn=null` rows, then a **repair scan** over recent stored orders so payload-in-range rows are never dropped.
   * Totals use the **latest timestamp** among summary `createdAt` and known payload fields that falls in the strict `[dateFrom, dateTo]` UTC window (aligns with LeafLink when submit vs create differ). Draft / cancelled / void orders are excluded.
   * Does not call LeafLink — run **Multi-page sync** / **Refresh** on the Orders page to update Postgres first.
   */
  async getOrdersAnalytics(
    companyId: string,
    input: { dateFrom: string; dateTo: string },
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
      | "totalStoredOrders"
      | "storedSnapshotMaxUpdatedAt"
      | "filteredByLeafLinkCurrentCustomerStatus"
      | "leafLinkCurrentCustomerCount"
      | "chartDaysCapped"
      | "qualifyingRevenueTotalUsd"
    > => ({
      readFromDatabase: true,
      leafLinkRefreshRan: false,
      storedRowsInRange: 0,
      totalStoredOrders: 0,
      storedSnapshotMaxUpdatedAt: null,
      filteredByLeafLinkCurrentCustomerStatus: false,
      leafLinkCurrentCustomerCount: 0,
      chartDaysCapped: false,
      qualifyingRevenueTotalUsd: 0,
    });

    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
      throw new AppError("Invalid date range.", 400, "ORDERS_ANALYTICS_BAD_RANGE");
    }
    if ((toMs - fromMs) / 86_400_000 > MAX_ANALYTICS_RANGE_DAYS) {
      throw new AppError(`Date range cannot exceed ${MAX_ANALYTICS_RANGE_DAYS} days.`, 400, "ORDERS_ANALYTICS_RANGE_TOO_WIDE");
    }

    const creds = await this.leafLinkService.resolveRuntimeCredentials(companyId);
    const baseConfigured = Boolean(creds.apiKey && (creds.companyId || creds.companySlug));

    if (!creds.integrationEnabled || !baseConfigured) {
      const totalStoredOrders = await countLeafLinkStoredOrdersForCompany(companyId);
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
        days: [],
        customers: [],
        qualifyingOrders: [],
        qualifyingOrdersTruncated: false,
        ...emptyMeta(),
        totalStoredOrders,
      };
    }

    await this.assertOrdersCapableOrThrow(creds);

    const totalStoredOrders = await countLeafLinkStoredOrdersForCompany(companyId);

    const filteredByLeafLinkCurrentCustomerStatus = false;
    const leafLinkCurrentCustomerCount = 0;

    type AnalyticsStoredRow = { id: string; payload: unknown; updatedAt: Date };

    /** Extra `createdOn` slack so rows whose DB timestamp skews from payload still hydrate (MTD vs LeafLink). */
    function padMsForCreatedOnHydration(windowFromMs: number, windowToMs: number): number {
      const span = windowToMs - windowFromMs;
      if (!Number.isFinite(span) || span < 0) return 86_400_000;
      if (span > 120 * 86_400_000) return 24 * 3600000;
      if (span > 31 * 86_400_000) return 2 * 86_400_000;
      return 4 * 86_400_000;
    }

    const padMs = padMsForCreatedOnHydration(fromMs, toMs);
    const paddedFrom = new Date(fromMs - padMs);
    const paddedTo = new Date(toMs + padMs);

    const paddedDb = await findLeafLinkStoredOrdersForCompanyInRange(companyId, {
      from: paddedFrom,
      to: paddedTo,
    });

    const nullCreatedDb = await findRecentLeafLinkStoredOrdersWithNullCreatedOn(
      companyId,
      STORED_ORDER_FETCH_HARD_CAP,
    );

    const byId = new Map<string, AnalyticsStoredRow>();
    for (const r of paddedDb) {
      const pair = collectedPairFromStoredPayload(r.payload);
      if (pair && isExcludedFromLeafLinkSalesKpi(pair.summary)) continue;
      byId.set(r.id, { id: r.id, payload: r.payload, updatedAt: r.updatedAt });
    }

    for (const r of nullCreatedDb) {
      if (byId.has(r.id)) continue;
      const pair = collectedPairFromStoredPayload(r.payload);
      if (!pair) continue;
      if (isExcludedFromLeafLinkSalesKpi(pair.summary)) continue;
      const t = orderChosenInstantMsForUtcRange(pair.raw, pair.summary, fromMs, toMs);
      if (t == null) continue;
      byId.set(r.id, { id: r.id, payload: r.payload, updatedAt: r.updatedAt });
    }

    const repairFetch = Math.min(STORED_ORDERS_LIST_SCAN_LIMIT, Math.max(totalStoredOrders, 1));
    const recentForRepair = await findRecentLeafLinkStoredOrdersForCompany(companyId, repairFetch);
    for (const r of recentForRepair) {
      if (byId.has(r.id)) continue;
      const pair = collectedPairFromStoredPayload(r.payload);
      if (!pair) continue;
      if (isExcludedFromLeafLinkSalesKpi(pair.summary)) continue;
      const t = orderChosenInstantMsForUtcRange(pair.raw, pair.summary, fromMs, toMs);
      if (t == null) continue;
      byId.set(r.id, { id: r.id, payload: r.payload, updatedAt: r.updatedAt });
    }

    const storedDb = [...byId.values()];

    if (totalStoredOrders > STORED_ORDERS_LIST_SCAN_LIMIT) {
      logWarn("[LEAFLINK] orders_analytics_catalogue_large", {
        companyId,
        syncedTotal: totalStoredOrders,
        rowsHydratedForAnalytics: storedDb.length,
        note: "Hydrates padded createdOn window + null-created + recent repair; totals use latest in-range payload/summary timestamp (UTC).",
      });
    }

    let storedRowsInRange = 0;
    for (const r of storedDb) {
      const pair = collectedPairFromStoredPayload(r.payload);
      if (!pair) continue;
      if (isExcludedFromLeafLinkSalesKpi(pair.summary)) continue;
      const t = orderChosenInstantMsForUtcRange(pair.raw, pair.summary, fromMs, toMs);
      if (t == null) continue;
      storedRowsInRange++;
    }

    const storedSnapshotMaxUpdatedAt =
      storedDb.reduce<Date | null>(
        (acc, r) => (!acc || r.updatedAt > acc ? r.updatedAt : acc),
        null,
      )?.toISOString() ?? null;

    const collected: { raw: Record<string, unknown>; summary: LeafLinkOrderSummaryDto }[] = [];
    for (const r of storedDb) {
      const pair = collectedPairFromStoredPayload(r.payload);
      if (!pair) continue;
      if (isExcludedFromLeafLinkSalesKpi(pair.summary)) continue;
      const t = orderChosenInstantMsForUtcRange(pair.raw, pair.summary, fromMs, toMs);
      if (t == null) continue;
      collected.push(pair);
    }

    let dayList = enumerateUtcDaysInclusive(dateFrom, dateTo);
    let chartDaysCapped = false;
    if (dayList.length > MAX_ANALYTICS_CHART_DAYS) {
      chartDaysCapped = true;
      dayList = dayList.slice(dayList.length - MAX_ANALYTICS_CHART_DAYS);
    }

    const nDays = dayList.length;
    const dayIndex = new Map<string, number>();
    dayList.forEach((d, i) => dayIndex.set(d, i));

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

      if (isExcludedFromLeafLinkSalesKpi(o)) continue;

      const t = orderChosenInstantMsForUtcRange(raw, o, fromMs, toMs);
      if (t == null) continue;

      const rawMoney = effectiveOrderTotalUsd(raw, o);
      const money = typeof rawMoney === "number" && Number.isFinite(rawMoney) ? Math.max(0, rawMoney) : 0;

      const day = utcDayKeyFromMs(t);
      const di = dayIndex.get(day);
      const inChartBuckets = di !== undefined;

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

      if (inChartBuckets && di !== undefined) {
        row.revenueByDay[di] += money;
        row.orderCountByDay[di] += 1;
      }

      for (const li of o.lineItems) {
        if (!isSampleLineItem(li)) continue;
        const q = li.quantity > 0 ? li.quantity : 1;
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
        if (inChartBuckets && di !== undefined)
          row.sampleUnitsByDay[di] += q;
      }
    }

    qualifyingOrdersFull.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    let qualifyingOrdersTruncated = false;
    let qualifyingOrders = qualifyingOrdersFull;
    if (qualifyingOrdersFull.length > MAX_QUALIFYING_ORDERS_IN_PAYLOAD) {
      qualifyingOrders = qualifyingOrdersFull.slice(0, MAX_QUALIFYING_ORDERS_IN_PAYLOAD);
      qualifyingOrdersTruncated = true;
    }

    const qualifyingRevenueTotalUsd =
      Math.round(
        qualifyingOrdersFull.reduce((s, row) => s + (Number(row.totalUsd) || 0), 0) * 100,
      ) / 100;

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
      chartDaysCapped,
      customerCount: customers.length,
      qualifyingOrdersReturned: qualifyingOrders.length,
      qualifyingOrdersTruncated,
      storedRowsInRange,
      totalStoredOrders,
      dateFrom,
      dateTo,
      leafLinkCurrentCustomerCount,
      filteredByLeafLinkCurrentCustomerStatus,
    });

    const noCachedMessage =
      totalStoredOrders === 0 || storedRowsInRange === 0
        ? "No cached LeafLink orders found for this range. Run recent sync."
        : null;

    return {
      source: "leaflink",
      configured: true,
      integrationEnabled: true,
      dateFrom,
      dateTo,
      ordersIncluded: qualifyingOrderCount,
      minOrderTotal: 0,
      pagesScanned: 0,
      truncated: false,
      days: dayList,
      customers,
      qualifyingOrders,
      qualifyingOrdersTruncated,
      qualifyingRevenueTotalUsd,
      readFromDatabase: true,
      leafLinkRefreshRan: false,
      storedRowsInRange,
      totalStoredOrders,
      chartDaysCapped,
      storedSnapshotMaxUpdatedAt,
      filteredByLeafLinkCurrentCustomerStatus,
      leafLinkCurrentCustomerCount,
      noCachedMessage,
    };
  }

  /** Incremental LeafLink → Neon sync (recent orders only). Guarded by per-company lock. */
  async syncOrdersWarm(
    companyId: string,
    lockOwner = "warm_sync",
  ): Promise<LeafLinkOrdersSyncDto> {
    const started = Date.now();
    const creds = await this.leafLinkService.resolveRuntimeCredentials(companyId);
    const nowIso = new Date().toISOString();
    const baseConfigured = Boolean(creds.apiKey && (creds.companyId || creds.companySlug));

    if (!creds.integrationEnabled || !baseOutConfiguredForOrders(creds)) {
      return {
        ok: true,
        configured: baseConfigured,
        integrationEnabled: creds.integrationEnabled,
        pagesPulled: 0,
        ordersSeen: 0,
        lastFetchedAt: nowIso,
        mode: "incremental",
      };
    }

    const lock = await acquireLeafLinkOrdersSyncLock(companyId, lockOwner);
    if (!lock.acquired) {
      return {
        ok: true,
        configured: true,
        integrationEnabled: true,
        pagesPulled: 0,
        ordersSeen: 0,
        lastFetchedAt: nowIso,
        skipped: true,
        reason: "sync_already_running",
        mode: "incremental",
      };
    }

    try {
      await this.assertOrdersCapableOrThrow(creds);
      const pulled = await this.pullLeafLinkOrdersReceivedToDb(companyId, {
        mode: "incremental",
        reuseCreds: creds,
      });

      await recordLeafLinkOrdersSyncRun({
        companyId,
        mode: "incremental",
        pagesPulled: pulled.pagesPulled,
        rowsPersisted: pulled.ordersPersisted,
        error: null,
        cursor: pulled.cursor,
        success: true,
      });

      const durationMs = Date.now() - started;
      logInfo("[LEAFLINK] orders_sync_complete", {
        companyId,
        mode: "incremental",
        pagesPulled: pulled.pagesPulled,
        rowsFetched: pulled.rowsFetched,
        rowsCreated: pulled.rowsCreated,
        rowsUpdated: pulled.rowsUpdated,
        rowsSkippedUnchanged: pulled.rowsSkippedUnchanged,
        stoppedReason: pulled.stoppedReason,
        durationMs,
        cutoffIso: pulled.cutoffIso,
      });

      return {
        ok: true,
        configured: true,
        integrationEnabled: true,
        pagesPulled: pulled.pagesPulled,
        ordersSeen: pulled.rowsFetched,
        syncComplete: pulled.syncComplete,
        hitPageCap: pulled.hitPageCap,
        lastFetchedAt: new Date().toISOString(),
        mode: "incremental",
        rowsCreated: pulled.rowsCreated,
        rowsUpdated: pulled.rowsUpdated,
        rowsSkippedUnchanged: pulled.rowsSkippedUnchanged,
        stoppedReason: pulled.stoppedReason,
        durationMs,
        cutoffIso: pulled.cutoffIso,
      };
    }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await recordLeafLinkOrdersSyncRun({
        companyId,
        mode: "incremental",
        pagesPulled: 0,
        rowsPersisted: 0,
        error: msg,
        success: false,
      });
      throw err;
    }
    finally {
      await releaseLeafLinkOrdersSyncLock(companyId);
    }
  }

  /** Manual admin-only historical rebuild — not used by UI page loads or cron warm sync. */
  async syncOrdersFullRebuild(companyId: string): Promise<LeafLinkOrdersSyncDto> {
    const started = Date.now();
    logInfo("[LEAFLINK] manual_full_rebuild_started", { companyId });

    const creds = await this.leafLinkService.resolveRuntimeCredentials(companyId);
    const baseConfigured = Boolean(creds.apiKey && (creds.companyId || creds.companySlug));

    if (!creds.integrationEnabled || !baseOutConfiguredForOrders(creds)) {
      return {
        ok: true,
        configured: baseConfigured,
        integrationEnabled: creds.integrationEnabled,
        pagesPulled: 0,
        ordersSeen: 0,
        lastFetchedAt: new Date().toISOString(),
        mode: "manual_full_rebuild",
      };
    }

    const lock = await acquireLeafLinkOrdersSyncLock(companyId, "manual_full_rebuild");
    if (!lock.acquired) {
      return {
        ok: true,
        configured: true,
        integrationEnabled: true,
        pagesPulled: 0,
        ordersSeen: 0,
        lastFetchedAt: new Date().toISOString(),
        skipped: true,
        reason: "sync_already_running",
        mode: "manual_full_rebuild",
      };
    }

    try {
      await this.assertOrdersCapableOrThrow(creds);
      const pulled = await this.pullLeafLinkOrdersReceivedToDb(companyId, {
        mode: "manual_full_rebuild",
        reuseCreds: creds,
      });

      await recordLeafLinkOrdersSyncRun({
        companyId,
        mode: "manual_full_rebuild",
        pagesPulled: pulled.pagesPulled,
        rowsPersisted: pulled.ordersPersisted,
        error: null,
        cursor: pulled.cursor,
        success: true,
      });

      const durationMs = Date.now() - started;
      logInfo("[LEAFLINK] manual_full_rebuild_finished", {
        companyId,
        pagesPulled: pulled.pagesPulled,
        rowsFetched: pulled.rowsFetched,
        stoppedReason: pulled.stoppedReason,
        durationMs,
      });

      return {
        ok: true,
        configured: true,
        integrationEnabled: true,
        pagesPulled: pulled.pagesPulled,
        ordersSeen: pulled.rowsFetched,
        syncComplete: pulled.syncComplete,
        hitPageCap: pulled.hitPageCap,
        lastFetchedAt: new Date().toISOString(),
        mode: "manual_full_rebuild",
        rowsCreated: pulled.rowsCreated,
        rowsUpdated: pulled.rowsUpdated,
        rowsSkippedUnchanged: pulled.rowsSkippedUnchanged,
        stoppedReason: pulled.stoppedReason,
        durationMs,
        cutoffIso: null,
      };
    }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await recordLeafLinkOrdersSyncRun({
        companyId,
        mode: "manual_full_rebuild",
        pagesPulled: 0,
        rowsPersisted: 0,
        error: msg,
        success: false,
      });
      throw err;
    }
    finally {
      await releaseLeafLinkOrdersSyncLock(companyId);
    }
  }

  async findOpenPaymentCandidatesForCheck(
    companyId: string,
    input: { invoiceNumber?: string; payerName?: string; amount?: number },
  ): Promise<LeafLinkPaymentMatchCandidateDto[]> {
    const rows = await findRecentLeafLinkStoredOrdersForCompany(companyId, 4000);
    return collectLeafLinkPaymentCandidatesFromDbRows(rows, input, { includePaid: false });
  }

  /**
   * Same scoring as {@link findOpenPaymentCandidatesForCheck} but includes **paid** orders so UIs can show
   * “already paid in LeafLink” and still link audit rows.
   */
  async findPaymentMatchCandidatesIncludingPaidForCheck(
    companyId: string,
    input: { invoiceNumber?: string; payerName?: string; amount?: number },
  ): Promise<LeafLinkPaymentMatchCandidateDto[]> {
    const rows = await findRecentLeafLinkStoredOrdersForCompany(companyId, 4000);
    return collectLeafLinkPaymentCandidatesFromDbRows(rows, input, { includePaid: true });
  }

  /** @deprecated Use {@link postOrderPayment} */
  async postCheckPayment(
    companyId: string,
    input: { orderNumber: string; amount: number; paymentDateIso: string; note: string; reference?: string | null },
  ): Promise<{ paymentId: string; paymentStatus: string; rawResponse: unknown }> {
    return this.postOrderPayment(companyId, { ...input, paymentMethod: "Check" });
  }

  async postOrderPayment(
    companyId: string,
    input: {
      orderNumber: string;
      /**
       * LeafLink wholesale `number` when it differs from the display `orderNumber` (e.g. short id vs label).
       * Check/cash flows pass `selected.orderId` from stored order payloads — often the same key LeafLink expects on `POST /v2/order-payments/`.
       */
      leafLinkOrderId?: string | null;
      amount: number;
      paymentDateIso: string;
      note: string;
      reference?: string | null;
      paymentMethod: "Check" | "Cash";
    },
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
    /**
     * LeafLink Marketplace V2 creates payments only via `POST /v2/order-payments/` with a DRF-shaped body
     * (`order`, `recorded_by`, `total.amount` + `currency`, `payment_date`, `reason`, `payment_type`).
     * Nested `…/orders-received/{n}/payments/` URLs are list-only in the public reference — posting there yields 405/404.
     */
    const orderRef = cleanString(
      input.leafLinkOrderId || input.orderNumber,
    ).replace(/^#/, "");
    if (!orderRef) {
      throw new AppError("Missing LeafLink order number for payment.", 400, "LEAFLINK_PAYMENT_ORDER_REQUIRED");
    }
    const recorderId = await resolvePaymentRecorderStaffId(this.leafLinkService, companyId, creds, creds.source);
    const amt = Number.isFinite(input.amount) ? Math.max(0, input.amount) : 0;
    const amountStr = amt.toFixed(2);
    const reference = cleanString(input.reference);
    const note = cleanString(input.note);
    const reasonParts = [note, reference ? `Ref: ${reference}` : ""].filter(Boolean);
    const reason = (reasonParts.join(" — ") || "Payment recorded via NexBatch").slice(0, 2000);
    const paymentType = input.paymentMethod === "Cash" ? "cash" : "check";
    const payDateRaw = cleanString(input.paymentDateIso);
    const paymentDate =
      /^\d{4}-\d{2}-\d{2}$/.test(payDateRaw) ? `${payDateRaw}T12:00:00.000Z` : (payDateRaw || new Date().toISOString());

    const payload: Record<string, unknown> = {
      order: orderRef,
      recorded_by: recorderId,
      total: { amount: amountStr, currency: "USD" },
      payment_date: paymentDate,
      reason,
      payment_type: paymentType,
    };
    const urls = [`${base}/v2/order-payments/`];
    const { body } = await leafLinkAuthedRequest(urls, creds, creds.source, 25_000, "POST", payload);
    const rec = asRecord(body);
    const paymentId =
      cleanString(rec.id || rec.payment_id || rec.uuid || rec.reference || rec.order_payment_id)
      || `leaflink-${Date.now()}`;
    const paymentStatus = cleanString(rec.status || rec.payment_status || rec.state) || "posted";
    return { paymentId, paymentStatus, rawResponse: body };
  }
}

function baseOutConfiguredForOrders(creds: LeafLinkRuntimeCredentials): boolean {
  return Boolean(creds.apiKey && (creds.companyId || creds.companySlug));
}
