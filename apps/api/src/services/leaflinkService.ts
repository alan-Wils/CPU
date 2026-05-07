import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";
import { logInfo, logWarn } from "../lib/logger.js";
import { ConfigRepository } from "../repositories/configRepository.js";
import { ConfigService } from "./configService.js";

const DEFAULT_BASE_URL = "https://app.leaflink.com/api";
const LEAFLINK_CONFIG_KEY = "leaflink";

type LeafLinkStoredConfig = {
  integrationEnabled?: boolean;
  companySlug?: string;
  companyId?: string;
  username?: string;
  apiKey?: string;
  baseUrl?: string;
};

type LeafLinkRuntimeCredentials = {
  integrationEnabled: boolean;
  companySlug: string;
  companyId: string;
  username: string;
  apiKey: string;
  baseUrl: string;
};

export type LeafLinkConfigReadDto = {
  integrationEnabled: boolean;
  companySlug: string;
  companyId: string;
  username: string;
  baseUrl: string;
  hasApiKey: boolean;
};

export type LeafLinkConfigWriteInput = {
  integrationEnabled: boolean;
  companySlug: string;
  companyId: string;
  username: string;
  baseUrl: string;
  apiKey?: string;
  clearApiKey?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function cleanString(v: unknown): string {
  return String(v || "").trim();
}

function envBool(v: unknown): boolean {
  const s = String(v || "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function baseUrlOrDefault(v: unknown): string {
  const raw = cleanString(v).replace(/\/+$/, "");
  return raw || DEFAULT_BASE_URL;
}

export class LeafLinkService {
  configService = new ConfigService();

  private async getStoredConfig(companyId: string): Promise<LeafLinkStoredConfig> {
    const rows = await this.configService.list(companyId);
    const row = rows.find((r) => r.key === LEAFLINK_CONFIG_KEY);
    return asRecord(row?.value) as LeafLinkStoredConfig;
  }

  async getSafeConfig(companyId: string): Promise<LeafLinkConfigReadDto> {
    const cfg = await this.getStoredConfig(companyId);
    return {
      integrationEnabled: Boolean(cfg.integrationEnabled ?? false),
      companySlug: cleanString(cfg.companySlug),
      companyId: cleanString(cfg.companyId),
      username: cleanString(cfg.username),
      baseUrl: baseUrlOrDefault(cfg.baseUrl),
      hasApiKey: cleanString(cfg.apiKey).length > 0,
    };
  }

  async upsertConfig(
    companyId: string,
    actorUserId: string,
    input: LeafLinkConfigWriteInput,
  ): Promise<LeafLinkConfigReadDto> {
    const prev = await this.getStoredConfig(companyId);
    const nextApiKey = input.clearApiKey
      ? ""
      : cleanString(input.apiKey).length > 0
        ? cleanString(input.apiKey)
        : cleanString(prev.apiKey);
    const next: LeafLinkStoredConfig = {
      integrationEnabled: Boolean(input.integrationEnabled),
      // Preserve existing non-secret values when UI submits empty strings.
      companySlug: cleanString(input.companySlug) || cleanString(prev.companySlug),
      companyId: cleanString(input.companyId) || cleanString(prev.companyId),
      username: cleanString(input.username) || cleanString(prev.username),
      apiKey: nextApiKey,
      baseUrl: baseUrlOrDefault(cleanString(input.baseUrl) || cleanString(prev.baseUrl)),
    };
    await this.configService.upsert({
      companyId,
      actorUserId,
      key: LEAFLINK_CONFIG_KEY,
      value: next,
    });
    return this.getSafeConfig(companyId);
  }

  async resolveRuntimeCredentials(companyId: string): Promise<LeafLinkRuntimeCredentials> {
    const cfg = await this.getStoredConfig(companyId);
    const integrationEnabled = Boolean(cfg.integrationEnabled ?? false) || envBool(process.env.LEAFLINK_ENABLED);
    const companySlug = cleanString(cfg.companySlug) || cleanString(process.env.LEAFLINK_COMPANY_SLUG);
    const cid = cleanString(cfg.companyId) || cleanString(process.env.LEAFLINK_COMPANY_ID);
    const username = cleanString(cfg.username) || cleanString(process.env.LEAFLINK_USERNAME);
    const apiKey = cleanString(cfg.apiKey) || cleanString(process.env.LEAFLINK_API_KEY);
    const baseUrl = baseUrlOrDefault(cfg.baseUrl || process.env.LEAFLINK_BASE_URL || env.LEAFLINK_BASE_URL);
    return {
      integrationEnabled,
      companySlug,
      companyId: cid,
      username,
      apiKey,
      baseUrl,
    };
  }
}

export type LeafLinkInventoryItem = {
  id: string;
  productName: string;
  sku: string;
  strain: string;
  /** Human-readable category (LeafLink often sends a numeric id in `category`). */
  category: string;
  productType: string;
  brand: string;
  availableQuantity: number;
  unit: string;
  packageSize: string;
  price: number | null;
  status: string;
  updatedAt: string;
  imageUrl: string;
  /**
   * Shared key for retail SKUs that split one extracted batch into 1g / 2g / 4g lines
   * (e.g. `B1658(GUAV-LSW)` from SKU `B1658(GUAV-LSW) 2g`).
   */
  sourcePackageGroup: string;
};

export type LeafLinkInventoryResponse = {
  source: "leaflink";
  items: LeafLinkInventoryItem[];
  stats: {
    totalSkus: number;
    totalInventoryUnits: number;
    totalInventoryValue: number;
    categoriesCount: number;
  };
  lastSyncedAt: string;
  /** True when served from Postgres company config without calling LeafLink. */
  fromCache?: boolean;
  /** How this payload was produced. */
  syncMode?: "cache" | "full" | "incremental";
  debug?: {
    endpoint: string;
    authMode: string;
    rootKeys: string[];
    listSource: string;
    rawRowCount: number;
    firstRowKeys: string[];
  };
};

const LEAFLINK_INVENTORY_CACHE_KEY = "leaflink_inventory_snapshot";

type LeafLinkPersistedInventory = {
  items: LeafLinkInventoryItem[];
  lastSyncedAt: string;
};

function appendModifiedGteFilter(endpointUrl: string, iso?: string): string {
  if (!iso?.trim()) return endpointUrl;
  try {
    const u = new URL(endpointUrl);
    u.searchParams.set("modified__gte", iso.trim());
    return u.href;
  }
  catch {
    return endpointUrl;
  }
}

function mergeLeafLinkSnapshots(
  previous: LeafLinkInventoryItem[] | undefined,
  incoming: LeafLinkInventoryItem[],
): LeafLinkInventoryItem[] {
  if (!previous?.length) return incoming;
  if (!incoming.length) return previous;
  const map = new Map(previous.map((x) => [x.id, x]));
  for (const row of incoming) map.set(row.id, row);
  return Array.from(map.values());
}

function buildLeafLinkStats(items: LeafLinkInventoryItem[]) {
  const categories = new Set(items.map((x) => x.category).filter(Boolean));
  const totalInventoryUnits = items.reduce((sum, row) => sum + toNumber(row.availableQuantity), 0);
  const totalInventoryValue = items.reduce((sum, row) => {
    const p = row.price == null ? 0 : toNumber(row.price);
    return sum + p * toNumber(row.availableQuantity);
  }, 0);
  return {
    totalSkus: items.length,
    totalInventoryUnits,
    totalInventoryValue,
    categoriesCount: categories.size,
  };
}

function toNumber(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pickString(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = cleanString(row[k]);
    if (v) return v;
  }
  return "";
}

function pickNumber(row: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const n = toNumber(row[k]);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return 0;
}

/** Prefer first present key — including legitimate `0` inventory (don't skip zeros). */
function pickInventoryQuantity(row: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    if (!(k in row))
      continue;
    const raw = row[k];
    if (raw === undefined || raw === null)
      continue;
    const n = toNumber(raw);
    if (Number.isFinite(n))
      return n;
  }
  return 0;
}

function coerceTotalCount(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw))
    return raw >= 0 ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0)
      return Math.floor(n);
  }
  return null;
}

function normalizeNextLeafLinkUrl(requestUrl: string, nextRaw: unknown): string | null {
  const s = typeof nextRaw === "string" ? nextRaw.trim() : "";
  if (!s)
    return null;
  try {
    if (/^https?:\/\//i.test(s))
      return s;
    const base = new URL(requestUrl);
    if (s.startsWith("/"))
      return `${base.origin}${s}`;
    return new URL(s, base.href).href;
  }
  catch {
    return null;
  }
}

function incrementPageQueryParam(pageUrl: string): string | null {
  try {
    const u = new URL(pageUrl);
    const cur = Number.parseInt(u.searchParams.get("page") || "1", 10);
    const next = Number.isFinite(cur) && cur > 0 ? cur + 1 : 2;
    u.searchParams.set("page", String(next));
    const ps = Number.parseInt(u.searchParams.get("page_size") || "", 10);
    if (!Number.isFinite(ps) || ps <= 0)
      u.searchParams.set("page_size", "500");
    return u.href;
  }
  catch {
    return null;
  }
}

/** Prefer max page_size (LeafLink list APIs default smaller pages). */
function withListingPagingHint(endpointUrl: string): string {
  try {
    const u = new URL(endpointUrl);
    if (!u.searchParams.has("page_size"))
      u.searchParams.set("page_size", "500");
    if (!u.searchParams.has("page"))
      u.searchParams.set("page", "1");
    return u.href;
  }
  catch {
    return endpointUrl;
  }
}

async function fetchAllLeafLinkPagedRows(
  firstUrl: string,
  init: RequestInit,
  timeoutMs: number,
  firstPayload?: unknown,
): Promise<{ rows: unknown[]; finalUrl: string; lastPayload: unknown }> {
  const aggregated: unknown[] = [];
  let url: string | null = firstUrl;
  let lastPayload: unknown = null;
  const maxPages = 200;
  for (let pg = 0; pg < maxPages && url; pg++) {
    const payload =
      pg === 0 && firstPayload != null ? firstPayload : await fetchJsonWithRetry(url, init, timeoutMs);
    lastPayload = payload;
    const root = asRecord(payload);
    const { list } = pickListSource(payload);
    aggregated.push(...list);

    let nextUrl = normalizeNextLeafLinkUrl(url, root.next);

    const total = coerceTotalCount(root.count);
    if (!nextUrl && total != null && aggregated.length < total && list.length > 0)
      nextUrl = incrementPageQueryParam(url);

    if (!nextUrl || nextUrl === url)
      break;

    url = nextUrl;
  }
  return { rows: aggregated, finalUrl: url || firstUrl, lastPayload };
}

function pickPrice(row: Record<string, unknown>): number | null {
  const direct = pickNumber(row, ["price", "unit_price", "sale_price", "wholesale_price"]);
  if (direct > 0) return direct;
  const nested = asRecord(row.price);
  const nestedVal = pickNumber(nested, ["amount", "value"]);
  return nestedVal > 0 ? nestedVal : null;
}

function isDigitsOnly(s: string): boolean {
  return /^\d+$/.test(s.trim());
}

/**
 * LeafLink product rows often expose `category` as a bare id (number) while the real label
 * lives on `product_type`, nested `category.name`, or `product_category`.
 */
function pickCategoryDisplay(row: Record<string, unknown>): string {
  const cat = row.category;
  if (cat != null && typeof cat === "object" && !Array.isArray(cat)) {
    const nm = pickString(asRecord(cat), ["name", "title", "label", "display_name"]);
    if (nm) return nm;
  }
  const pcat = row.product_category;
  if (pcat != null && typeof pcat === "object" && !Array.isArray(pcat)) {
    const nm = pickString(asRecord(pcat), ["name", "title", "label", "display_name"]);
    if (nm) return nm;
  }
  const flat = pickString(row, [
    "category_name",
    "product_category_name",
    "category_display_name",
    "display_category",
  ]);
  if (flat && !isDigitsOnly(flat)) return flat;

  const typeGuess = pickString(row, [
    "product_type",
    "type",
    "product_type_display",
    "product_type_name",
    "product_class",
    "item_category",
  ]);
  const rawId =
    typeof cat === "number"
      ? String(cat)
      : typeof cat === "string"
        ? cat.trim()
        : pickString(row, ["category_id"]);
  const categoryString = pickString(row, ["category", "category_name"]);
  const idLike =
    (categoryString && isDigitsOnly(categoryString)) ||
    (rawId && isDigitsOnly(rawId)) ||
    (flat && isDigitsOnly(flat));
  if (idLike) {
    if (typeGuess && !isDigitsOnly(typeGuess)) return typeGuess;
    const id = categoryString && isDigitsOnly(categoryString) ? categoryString : rawId || flat;
    return id ? `Category #${id}` : typeGuess;
  }
  const direct = pickString(row, ["category", "category_name"]);
  return direct || typeGuess;
}

/**
 * Group key for variants that share one bulk/extracted package (Metrc batch-style codes in SKU).
 */
function deriveSourcePackageGroup(sku: string, productName: string): string {
  const s = (sku || "").trim();
  const parenBatch = s.match(/^(B\d+\([^)]+\))/i);
  if (parenBatch) return parenBatch[1];
  const dateSku = s.match(/^(\d{2}\.\d{2}\.\d{2})/);
  if (dateSku) return dateSku[1];
  if (s) return s;
  return (productName || "").trim() || "—";
}

function pickListSource(raw: unknown): { list: unknown[]; source: string } {
  const root = asRecord(raw);
  if (Array.isArray(root.data)) return { list: root.data, source: "data" };
  if (Array.isArray(root.results)) return { list: root.results, source: "results" };
  const content = asRecord(root.content);
  if (Array.isArray(content.results)) return { list: content.results, source: "content.results" };
  if (Array.isArray(content.products)) return { list: content.products, source: "content.products" };
  if (Array.isArray(root.products)) return { list: root.products, source: "products" };
  if (Array.isArray(root.items)) return { list: root.items, source: "items" };
  if (Array.isArray(raw)) return { list: raw, source: "raw_array" };
  return { list: [], source: "none" };
}

function normalizeRows(raw: unknown): LeafLinkInventoryItem[] {
  const { list } = pickListSource(raw);
  const out: LeafLinkInventoryItem[] = [];
  for (const item of list as unknown[]) {
    const row = asRecord(item);
    const id = pickString(row, ["id", "inventory_id", "product_id", "sku"]);
    if (!id) continue;
    const availableQuantity = pickInventoryQuantity(row, [
      "available_inventory",
      "available_quantity",
      "quantity_available",
      "quantity",
      "available",
      "on_hand_quantity",
    ]);
    const status = pickString(row, [
      "status",
      "availability",
      "state",
      "listing_state",
      "display_listing_state",
    ]).toLowerCase();
    const explicitlyUnavailable =
      status.includes("unavailable") ||
      status.includes("archived") ||
      status.includes("inactive") ||
      status.includes("out_of_stock");
    // Keep rows unless they are clearly unavailable and have no stock.
    if (explicitlyUnavailable && availableQuantity <= 0) continue;
    const productName = pickString(row, ["product_name", "name", "title"]);
    const sku = pickString(row, ["sku", "product_sku"]);
    out.push({
      id,
      productName,
      sku,
      strain: pickString(row, ["strain", "strain_name"]),
      category: pickCategoryDisplay(row),
      productType: pickString(row, ["product_type", "type"]),
      brand: pickString(row, ["brand", "brand_name", "vendor_name"]),
      availableQuantity,
      unit: pickString(row, ["unit", "unit_of_measure", "sell_in_unit_of_measure", "uom"]),
      packageSize: pickString(row, ["package_size", "size", "unit_multiplier"]),
      price: pickPrice(row),
      status: pickString(row, ["status", "availability", "state", "listing_state", "display_listing_state"]),
      updatedAt: pickString(row, ["updated_at", "updatedAt", "modified_at", "modified", "last_edit"]),
      imageUrl:
        pickString(row, ["image_url", "image", "thumbnail_url"]) ||
        pickString(asRecord((Array.isArray(row.images) ? row.images[0] : undefined)), [
          "url",
          "image_url",
          "thumbnail_url",
        ]),
      sourcePackageGroup: deriveSourcePackageGroup(sku, productName),
    });
  }
  return out;
}

async function fetchJsonWithRetry(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  let lastErr: unknown;
  for (let i = 0; i < 2; i += 1) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      logInfo("[LEAFLINK] request_start", {
        url,
        method: init.method || "GET",
        attempt: i + 1,
      });
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      const text = await res.text();
      const contentType = String(res.headers.get("content-type") || "").toLowerCase();
      const trimmed = String(text || "").trim();
      const isJsonByHeader = contentType.includes("application/json") || contentType.includes("+json");
      const isJsonByBody = trimmed.startsWith("{") || trimmed.startsWith("[");
      const isJson = isJsonByHeader || isJsonByBody;
      const isHtml = contentType.includes("text/html") || /^<(?:!doctype|html|head|body)\b/i.test(trimmed);
      logInfo("[LEAFLINK] response_meta", {
        url,
        status: res.status,
        contentType,
        isJson,
        isHtml,
      });
      if (!res.ok) {
        if (res.status >= 500 && i === 0) {
          lastErr = new AppError("LeafLink temporary server error. Retrying.", 502, "LEAFLINK_TEMPORARY");
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          throw new AppError("LeafLink credentials are invalid for this company.", 401, "LEAFLINK_INVALID_CREDENTIALS");
        }
        if (isHtml) {
          throw new AppError(
            "LeafLink returned an HTML error response instead of JSON.",
            502,
            "LEAFLINK_HTML_ERROR",
            {
              status: res.status,
              contentType,
              preview: trimmed.slice(0, 220),
            },
          );
        }
        throw new AppError(`LeafLink request failed (${res.status}).`, 502, "LEAFLINK_REQUEST_FAILED");
      }
      if (!isJson) {
        throw new AppError(
          "LeafLink returned a non-JSON response.",
          502,
          "LEAFLINK_NON_JSON_RESPONSE",
          {
            status: res.status,
            contentType,
            preview: trimmed.slice(0, 220),
          },
        );
      }
      try {
        return trimmed ? JSON.parse(trimmed) : {};
      } catch {
        throw new AppError(
          "LeafLink returned invalid JSON.",
          502,
          "LEAFLINK_INVALID_JSON",
          {
            status: res.status,
            contentType,
            preview: trimmed.slice(0, 220),
          },
        );
      }
    } catch (error) {
      lastErr = error;
      const isAbort = error instanceof Error && error.name === "AbortError";
      if (isAbort) {
        throw new AppError("LeafLink request timed out.", 504, "LEAFLINK_TIMEOUT");
      }
      logWarn("[LEAFLINK] request_failed", {
        url,
        attempt: i + 1,
        error: error instanceof Error ? error.message : String(error),
      });
      if (i === 1) throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("LeafLink request failed");
}

async function fetchLeafLinkInventoryFromApi(
  creds: LeafLinkRuntimeCredentials,
  modifiedGte: string | undefined,
  debug: boolean,
): Promise<{
  items: LeafLinkInventoryItem[];
  usedEndpoint: string;
  usedAuthMode: string;
  mergedListSourceTag: string;
  rawRowCount: number;
  firstPageCount: number;
  firstRowKeys: string[];
  firstRootKeys: string[];
}> {
  const base = creds.baseUrl.replace(/\/+$/, "");
  const hasCompanyScope = Boolean(creds.companyId || creds.companySlug);
  const endpointCandidates = [
    creds.companyId ? `${base}/v2/companies/${encodeURIComponent(creds.companyId)}/products/` : "",
    creds.companyId ? `${base}/v2/products/?company=${encodeURIComponent(creds.companyId)}` : "",
    creds.companyId ? `${base}/products/?company=${encodeURIComponent(creds.companyId)}` : "",
    creds.companySlug ? `${base}/v2/products/?company_slug=${encodeURIComponent(creds.companySlug)}` : "",
    creds.companySlug ? `${base}/products/?company_slug=${encodeURIComponent(creds.companySlug)}` : "",
    ...(hasCompanyScope ? [] : [`${base}/v2/products/`, `${base}/products/`]),
  ]
    .filter(Boolean)
    .map((endpointUrl) => {
      let u = withListingPagingHint(String(endpointUrl));
      if (modifiedGte) u = appendModifiedGteFilter(u, modifiedGte);
      return u;
    });
  const basicAuth = creds.username ? Buffer.from(`${creds.username}:${creds.apiKey}`).toString("base64") : "";
  const authCandidates = [
    `App ${creds.apiKey}`,
    `Token ${creds.apiKey}`,
    `Bearer ${creds.apiKey}`,
    ...(basicAuth ? [`Basic ${basicAuth}`] : []),
  ];

  let payload: unknown = null;
  let usedEndpoint = "";
  let usedAuthMode = "";
  let successInit: RequestInit | null = null;
  let lastErr: unknown = null;
  outer: for (const endpoint of endpointCandidates) {
    for (const authValue of authCandidates) {
      const authMode = authValue.startsWith("App ")
        ? "App"
        : authValue.startsWith("Token ")
          ? "Token"
          : authValue.startsWith("Bearer ")
            ? "Bearer"
            : "Basic";
      const leafLinkInit: RequestInit = {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: authValue,
          "X-API-KEY": creds.apiKey,
          "x-api-key": creds.apiKey,
          "X-Company-Slug": creds.companySlug,
          "X-LeafLink-Company-Id": creds.companyId,
          "X-LeafLink-Username": creds.username,
        },
      };
      try {
        payload = await fetchJsonWithRetry(endpoint, leafLinkInit, 15_000);
        usedEndpoint = endpoint;
        usedAuthMode = authMode;
        successInit = leafLinkInit;
        break outer;
      } catch (error) {
        lastErr = error;
        const code = error instanceof AppError ? error.code : "";
        if (
          code === "LEAFLINK_INVALID_CREDENTIALS" ||
          code === "LEAFLINK_REQUEST_FAILED" ||
          code === "LEAFLINK_NON_JSON_RESPONSE" ||
          code === "LEAFLINK_HTML_ERROR"
        ) {
          continue;
        }
        throw error;
      }
    }
  }
  if (payload == null || successInit == null) {
    if (lastErr instanceof AppError) throw lastErr;
    throw new AppError("LeafLink inventory request failed for all endpoint/auth combinations.", 502, "LEAFLINK_REQUEST_FAILED");
  }

  const firstRoot = asRecord(payload);
  const firstPageCount = pickListSource(payload).list.length;
  const merged = await fetchAllLeafLinkPagedRows(usedEndpoint, successInit, 15_000, payload);
  const mergedPayload = { results: merged.rows };
  const { source: mergedListSourceTag } = pickListSource(mergedPayload);

  const firstRowKeys =
    merged.rows.length > 0 ? Object.keys(asRecord(merged.rows[0])).slice(0, 80) : [];
  logInfo("[LEAFLINK] normalize_preview", {
    endpoint: usedEndpoint,
    endpointFinalHint: merged.finalUrl.slice(0, 220),
    authMode: usedAuthMode,
    rootKeys: Object.keys(firstRoot).slice(0, 40),
    listSource: mergedListSourceTag,
    rawRowCount: merged.rows.length,
    rawRowCountFirstPage: firstPageCount,
    firstRowKeys,
    modifiedGte: modifiedGte || null,
  });

  const items = normalizeRows(mergedPayload);
  if (debug) {
    logInfo("[LEAFLINK] pull_complete", {
      itemCount: items.length,
      modifiedGte: modifiedGte || null,
    });
  }
  return {
    items,
    usedEndpoint,
    usedAuthMode,
    mergedListSourceTag,
    rawRowCount: merged.rows.length,
    firstPageCount,
    firstRowKeys,
    firstRootKeys: Object.keys(firstRoot).slice(0, 60),
  };
}

export class LeafLinkInventoryService {
  leafLinkService = new LeafLinkService();
  configService = new ConfigService();
  configRepo = new ConfigRepository();

  private async loadPersistedInventory(companyId: string): Promise<LeafLinkPersistedInventory | null> {
    const row = await this.configRepo.getConfigRaw(companyId, LEAFLINK_INVENTORY_CACHE_KEY);
    if (!row?.valueJson) return null;
    try {
      const v = JSON.parse(row.valueJson) as LeafLinkPersistedInventory;
      if (!Array.isArray(v.items)) return null;
      return v;
    }
    catch {
      return null;
    }
  }

  private async persistInventorySnapshot(
    companyId: string,
    snapshot: LeafLinkPersistedInventory,
    actorUserId: string,
  ): Promise<void> {
    await this.configService.upsert({
      companyId,
      actorUserId: actorUserId || "system",
      key: LEAFLINK_INVENTORY_CACHE_KEY,
      value: snapshot,
    });
  }

  private responseFromItems(
    items: LeafLinkInventoryItem[],
    lastSyncedAt: string,
    extra: Partial<LeafLinkInventoryResponse>,
    debugPayload?: LeafLinkInventoryResponse["debug"],
  ): LeafLinkInventoryResponse {
    const out: LeafLinkInventoryResponse = {
      source: "leaflink",
      items,
      stats: buildLeafLinkStats(items),
      lastSyncedAt,
      ...extra,
    };
    if (debugPayload) out.debug = debugPayload;
    return out;
  }

  async fetchAvailableInventory(
    companyId: string,
    opts?: { debug?: boolean; refresh?: boolean; actorUserId?: string },
  ): Promise<LeafLinkInventoryResponse> {
    const creds = await this.leafLinkService.resolveRuntimeCredentials(companyId);
    if (!creds.integrationEnabled) {
      throw new AppError("LeafLink sync is disabled for this company.", 400, "LEAFLINK_DISABLED");
    }
    if (!creds.apiKey || (!creds.companyId && !creds.companySlug)) {
      throw new AppError(
        "LeafLink is not fully configured. Set at least company ID or company slug, plus API key.",
        400,
        "LEAFLINK_MISSING_CONFIG",
      );
    }

    const refresh = Boolean(opts?.refresh);
    const debug = Boolean(opts?.debug);
    const actorUserId = String(opts?.actorUserId || "").trim();

    const persisted = await this.loadPersistedInventory(companyId);
    if (!refresh && persisted?.items?.length) {
      return this.responseFromItems(persisted.items, persisted.lastSyncedAt, {
        fromCache: true,
        syncMode: "cache",
      });
    }

    const incrementalSince =
      refresh && persisted?.items?.length && persisted.lastSyncedAt ? persisted.lastSyncedAt : undefined;

    const runPull = (modifiedGte: string | undefined) =>
      fetchLeafLinkInventoryFromApi(creds, modifiedGte, debug);

    let pull: Awaited<ReturnType<typeof fetchLeafLinkInventoryFromApi>>;
    let usedIncremental = Boolean(incrementalSince);
    try {
      pull = await runPull(incrementalSince);
    }
    catch (firstErr) {
      if (incrementalSince) {
        logWarn("[LEAFLINK] incremental_pull_failed_fallback_full", {
          message: firstErr instanceof Error ? firstErr.message : String(firstErr),
        });
        pull = await runPull(undefined);
        usedIncremental = false;
      }
      else {
        throw firstErr;
      }
    }

    if (usedIncremental && pull.items.length === 0 && persisted?.items?.length) {
      const now = new Date().toISOString();
      await this.persistInventorySnapshot(companyId, { items: persisted.items, lastSyncedAt: now }, actorUserId);
      return this.responseFromItems(persisted.items, now, {
        fromCache: false,
        syncMode: "incremental",
      });
    }

    const mergedItems =
      usedIncremental && persisted?.items?.length
        ? mergeLeafLinkSnapshots(persisted.items, pull.items)
        : pull.items;

    const lastSyncedAt = new Date().toISOString();
    await this.persistInventorySnapshot(companyId, { items: mergedItems, lastSyncedAt }, actorUserId);

    const debugBlock =
      debug
        ? {
            endpoint: pull.usedEndpoint,
            authMode: pull.usedAuthMode,
            rootKeys: pull.firstRootKeys,
            listSource: pull.mergedListSourceTag,
            rawRowCount: pull.rawRowCount,
            firstRowKeys: pull.firstRowKeys,
          }
        : undefined;

    return this.responseFromItems(mergedItems, lastSyncedAt, {
      fromCache: false,
      syncMode: usedIncremental ? "incremental" : "full",
    }, debugBlock);
  }
}

