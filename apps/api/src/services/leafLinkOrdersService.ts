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

function looksLikeUuidOrHash(v: string): boolean {
  const s = cleanString(v).toLowerCase();
  if (!s) return false;
  if (/^[0-9a-f]{8}$/.test(s)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s))
    return true;
  return false;
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

function extractLineItems(raw: Record<string, unknown>): LeafLinkOrderLineItemDto[] {
  const arr = raw.line_items;
  if (!Array.isArray(arr)) return [];
  const out: LeafLinkOrderLineItemDto[] = [];
  for (let i = 0; i < arr.length; i++) {
    const li = arr[i];
    const r = asRecord(li);
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
      productName = cleanString(
        r.product_name
        || r.name
        || r.title
        || r.item_name
        || r.inventory_name
        || r.listing_name
        || r.display_name,
      );
    }
    if (!sku) {
      sku = cleanString(r.sku || r.product_sku || r.item_sku || r.inventory_sku);
    }
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
  /** Human-facing order number shown in LeafLink UI where available. */
  const displayCandidates = [
    row.number,
    row.order_number,
    row.order_seller_number,
    row.seller_order_number,
    row.display_number,
    row.human_readable_id,
    row.reference_number,
    row.order_reference,
    row.external_order_number,
    row.external_id,
    row.code,
    row.name,
    nestedOrder.number,
    nestedOrder.order_number,
    nestedOrder.display_number,
    nestedOrder.human_readable_id,
    row.order_short_number,
    row.short_id,
    row.po_number,
  ].map(cleanString).filter(Boolean);
  const displayPreferred = displayCandidates.find((c) => !looksLikeUuidOrHash(c)) || displayCandidates[0];
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
    cleanString(row.order_short_number || row.short_id || row.order_seller_number) || displayOrderNumber.slice(0, 12);

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
    if (cleanString(r.id || r.order_id || r.number || r.order_number || r.short_id || r.order_short_number))
      return normalizeOrder(body);
    return null;
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
