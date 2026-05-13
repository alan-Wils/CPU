import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";
import { logInfo } from "../lib/logger.js";
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
  /** LeafLink `company-staff` id used as `recorded_by` on `POST /v2/order-payments/`. */
  recordedByStaffId?: number | string;
};

export type LeafLinkRuntimeCredentials = {
  integrationEnabled: boolean;
  companySlug: string;
  companyId: string;
  username: string;
  apiKey: string;
  baseUrl: string;
};

export type LeafLinkCredentialSource = "db" | "env";

export type LeafLinkResolvedCredentials = LeafLinkRuntimeCredentials & {
  source: LeafLinkCredentialSource;
};

export type LeafLinkConfigReadDto = {
  integrationEnabled: boolean;
  companySlug: string;
  companyId: string;
  username: string;
  baseUrl: string;
  hasApiKey: boolean;
  /** When set, check/cash “mark paid” uses this LeafLink company-staff row as `recorded_by`. */
  recordedByStaffId: number | null;
};

export type LeafLinkConfigWriteInput = {
  integrationEnabled: boolean;
  companySlug: string;
  companyId: string;
  username: string;
  baseUrl: string;
  apiKey?: string;
  clearApiKey?: boolean;
  /** Omit to preserve; set null to clear and fall back to env / auto staff list. */
  recordedByStaffId?: number | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function cleanString(v: unknown): string {
  return String(v || "").trim();
}

function parseRecordedByStaffId(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0)
    return Math.trunc(raw);
  const s = cleanString(raw);
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Short human-readable fragment from LeafLink/DRF JSON error bodies for logs and AppError messages. */
function leafLinkErrorDetailFromBody(parsed: unknown): string {
  if (parsed == null) return "";
  if (typeof parsed === "string")
    return parsed.length > 400 ? `${parsed.slice(0, 397)}…` : parsed;
  if (typeof parsed !== "object" || Array.isArray(parsed)) return "";
  const o = parsed as Record<string, unknown>;
  const pick = (v: unknown): string => {
    if (v == null) return "";
    if (typeof v === "string") return v.length > 400 ? `${v.slice(0, 397)}…` : v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (Array.isArray(v)) {
      const parts = v.map((x) => pick(x)).filter(Boolean);
      return parts.join("; ");
    }
    if (typeof v === "object") {
      try {
        const s = JSON.stringify(v);
        return s.length > 400 ? `${s.slice(0, 397)}…` : s;
      }
      catch {
        return "";
      }
    }
    return "";
  };
  const detail =
    pick(o.detail)
    || pick(o.message)
    || pick(o.error)
    || pick(o.non_field_errors)
    || pick(o.errors);
  return detail ? `— ${detail}` : "";
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
      recordedByStaffId: parseRecordedByStaffId(cfg.recordedByStaffId),
    };
  }

  /**
   * Company-staff id for LeafLink order payments (`recorded_by`), if configured on the tenant.
   * Does not read process env — callers merge env themselves when appropriate.
   */
  async getRecordedByStaffIdFromConfig(companyId: string): Promise<number | null> {
    const cfg = await this.getStoredConfig(companyId);
    return parseRecordedByStaffId(cfg.recordedByStaffId);
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
      recordedByStaffId:
        input.recordedByStaffId === undefined
          ? prev.recordedByStaffId
          : input.recordedByStaffId === null
            ? undefined
            : input.recordedByStaffId,
    };
    await this.configService.upsert({
      companyId,
      actorUserId,
      key: LEAFLINK_CONFIG_KEY,
      value: next,
    });
    return this.getSafeConfig(companyId);
  }

  async resolveRuntimeCredentials(
    companyId: string,
    opts?: { source?: "auto" | LeafLinkCredentialSource },
  ): Promise<LeafLinkResolvedCredentials> {
    const cfg = await this.getStoredConfig(companyId);
    const dbCreds = {
      integrationEnabled: Boolean(cfg.integrationEnabled ?? false),
      companySlug: cleanString(cfg.companySlug),
      companyId: cleanString(cfg.companyId),
      username: cleanString(cfg.username),
      apiKey: cleanString(cfg.apiKey),
      baseUrl: baseUrlOrDefault(cfg.baseUrl),
    };
    const envCreds = {
      integrationEnabled: envBool(process.env.LEAFLINK_ENABLED),
      companySlug: cleanString(process.env.LEAFLINK_COMPANY_SLUG),
      companyId: cleanString(process.env.LEAFLINK_COMPANY_ID),
      username: cleanString(process.env.LEAFLINK_USERNAME),
      apiKey: cleanString(process.env.LEAFLINK_API_KEY),
      baseUrl: baseUrlOrDefault(process.env.LEAFLINK_BASE_URL || env.LEAFLINK_BASE_URL),
    };
    const requestedSource = opts?.source ?? "auto";
    let source: LeafLinkCredentialSource;
    if (requestedSource === "db" || requestedSource === "env") {
      source = requestedSource;
    } else {
      const dbConfigured = Boolean(dbCreds.apiKey && (dbCreds.companyId || dbCreds.companySlug));
      source = dbConfigured ? "db" : "env";
    }
    const selected = source === "db" ? dbCreds : envCreds;
    return {
      integrationEnabled: selected.integrationEnabled,
      companySlug: selected.companySlug,
      companyId: selected.companyId,
      username: selected.username,
      apiKey: selected.apiKey,
      baseUrl: selected.baseUrl,
      source,
    };
  }
}

export function leafLinkAuthMode(authValue: string): "App" | "Token" | "Bearer" | "Basic" {
  if (authValue.startsWith("App ")) return "App";
  if (authValue.startsWith("Token ")) return "Token";
  if (authValue.startsWith("Bearer ")) return "Bearer";
  return "Basic";
}

export function buildLeafLinkAuthCandidates(creds: LeafLinkRuntimeCredentials): string[] {
  const basicAuth = creds.username ? Buffer.from(`${creds.username}:${creds.apiKey}`, "utf8").toString("base64") : "";
  return [
    `App ${creds.apiKey}`,
    `Token ${creds.apiKey}`,
    `Bearer ${creds.apiKey}`,
    ...(basicAuth ? [`Basic ${basicAuth}`] : []),
  ];
}

export function buildLeafLinkHeaders(
  creds: LeafLinkRuntimeCredentials,
  authValue: string,
  opts?: { contentType?: string },
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: authValue,
    "X-API-KEY": creds.apiKey,
    "x-api-key": creds.apiKey,
    "X-Company-Slug": creds.companySlug,
    "X-LeafLink-Company-Id": creds.companyId,
    "X-LeafLink-Username": creds.username,
  };
  if (opts?.contentType) headers["Content-Type"] = opts.contentType;
  return headers;
}

export type LeafLinkInventoryItem = {
  id: string;
  productName: string;
  sku: string;
  strain: string;
  /** Human-readable category (LeafLink often sends a numeric id in `category`). */
  category: string;
  /** Concentrates / Edibles / … — same as historical `product_type` column from LeafLink. */
  productType: string;
  /** Finer bucket: Live Sugar Wax, Disposable, Pre-Roll, … (explicit subcategory or product type when distinct from category). */
  subcategory: string;
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
  /**
   * When LeafLink sends explicit flags, inventory sync uses them with `status` to set NexBatch `availabilityStatus`.
   * Omitted when not present on the payload.
   */
  listingActive?: boolean;
  wholesaleAvailable?: boolean;
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

/**
 * Rows counted in the Inventory page "Total Inventory Value" with **default** UI filters:
 * `availabilityFilter === "in_stock"` and `statusFilter === "Available"`.
 * Keep aligned with `app/inventory/page.tsx`.
 */
export function leafLinkInventoryRowsForPageDefaultTotals(rows: LeafLinkInventoryItem[]): LeafLinkInventoryItem[] {
  return rows.filter((row) => {
    if (!(toNumber(row.availableQuantity) > 0)) return false;
    const a = String(row.status || "").trim().toLowerCase();
    return a === "available";
  });
}

/** Sum wholesale/unit price × available qty (same formula as Inventory page stats). */
export function sumLeafLinkInventoryValueUsd(rows: LeafLinkInventoryItem[]): number {
  return rows.reduce((sum, row) => {
    const p = row.price == null ? 0 : toNumber(row.price);
    return sum + p * toNumber(row.availableQuantity);
  }, 0);
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

/** LeafLink often sends **total** `quantity` plus **reserved**; sellable stock is `available` / `available_inventory` or total − reserved. */
const LEAFLINK_AVAILABLE_QTY_KEYS = [
  "available_inventory",
  "wholesale_available_quantity",
  "available_quantity",
  "quantity_available",
  "available_units",
  "units_available",
  "sellable_quantity",
  "inventory_available",
  "available_for_sale_quantity",
  "available_for_wholesale_quantity",
  "available",
] as const;

const LEAFLINK_RESERVED_QTY_KEYS = [
  "reserved_quantity",
  "quantity_reserved",
  "reserved",
  "committed_quantity",
  "reserved_units",
  "units_reserved",
] as const;

const LEAFLINK_TOTAL_QTY_KEYS = [
  "quantity",
  "inventory_count",
  "total_quantity",
  "on_hand_quantity",
  "on_hand",
  "total_units",
  "units",
  "inventory_quantity",
] as const;

function hasExplicitAvailableField(src: Record<string, unknown>): boolean {
  for (const k of LEAFLINK_AVAILABLE_QTY_KEYS) {
    if (k in src && src[k] !== undefined && src[k] !== null) return true;
  }
  return false;
}

function pickExplicitAvailableFrom(src: Record<string, unknown>): number | null {
  if (!hasExplicitAvailableField(src)) return null;
  return pickInventoryQuantity(src, [...LEAFLINK_AVAILABLE_QTY_KEYS]);
}

function pickTotalMinusReservedFrom(src: Record<string, unknown>): number | null {
  const hasReserved = LEAFLINK_RESERVED_QTY_KEYS.some((k) => k in src);
  if (!hasReserved) return null;
  const total = pickInventoryQuantity(src, [...LEAFLINK_TOTAL_QTY_KEYS]);
  const reserved = pickInventoryQuantity(src, [...LEAFLINK_RESERVED_QTY_KEYS]);
  if (!Number.isFinite(total) || total < 0) return null;
  if (!Number.isFinite(reserved) || reserved < 0) return null;
  return Math.max(0, Math.floor(total - reserved));
}

/**
 * Wholesale / orderable units LeafLink shows as **Available**, not total on hand (reserved is not sellable).
 * Checks top-level row plus nested `listing` and `product` objects.
 */
function pickLeafLinkAvailableQuantity(row: Record<string, unknown>): number {
  const listing =
    row.listing != null && typeof row.listing === "object" && !Array.isArray(row.listing)
      ? asRecord(row.listing)
      : null;
  const product =
    row.product != null && typeof row.product === "object" && !Array.isArray(row.product)
      ? asRecord(row.product)
      : null;
  const sources = [row, listing, product].filter((s): s is Record<string, unknown> => s != null);

  for (const src of sources) {
    const v = pickExplicitAvailableFrom(src);
    if (v !== null) return Math.max(0, Math.floor(v));
  }

  for (const src of sources) {
    const tmr = pickTotalMinusReservedFrom(src);
    if (tmr !== null) return tmr;
  }

  for (const src of sources) {
    const q = pickInventoryQuantity(src, [...LEAFLINK_TOTAL_QTY_KEYS]);
    if (q > 0) return Math.max(0, Math.floor(q));
  }

  for (const src of sources) {
    const q = pickInventoryQuantity(src, [...LEAFLINK_TOTAL_QTY_KEYS]);
    if (Number.isFinite(q)) return Math.max(0, Math.floor(q));
  }
  return 0;
}

/** First matching key wins; `undefined` if no key present or value unrecognized. */
function pickTriStateBool(row: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const k of keys) {
    if (!(k in row)) continue;
    const v = row[k];
    if (v === true) return true;
    if (v === false) return false;
    if (v === 1 || v === "1") return true;
    if (v === 0 || v === "0") return false;
    const t = typeof v === "string" ? v.trim().toLowerCase() : "";
    if (t === "true" || t === "yes" || t === "on") return true;
    if (t === "false" || t === "no" || t === "off") return false;
  }
  return undefined;
}

function leafLinkPublicOrigin(): string {
  const raw = String(env.LEAFLINK_BASE_URL || DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
  try {
    const u = new URL(raw);
    return u.origin;
  } catch {
    return "https://app.leaflink.com";
  }
}

/**
 * LeafLink sometimes returns `/media/...` paths. NexBatch stores absolute URLs so `<img src>` works from the app origin.
 */
export function absolutizeLeafLinkMediaUrl(href: string): string {
  const s = String(href || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return `https:${s}`;
  if (s.startsWith("/")) return `${leafLinkPublicOrigin()}${s}`;
  return s;
}

const LEAFLINK_IMAGE_URL_KEYS = [
  "image_url",
  "thumbnail_url",
  "photo_url",
  "primary_image_url",
  "large_image_url",
  "product_image_url",
  "listing_image_url",
  "image_url_large",
  "preview_image_url",
  "hero_image_url",
];

/** Best-effort product/listing image URL from a LeafLink inventory API row. */
export function pickLeafLinkImageUrl(row: Record<string, unknown>): string {
  let s = pickString(row, LEAFLINK_IMAGE_URL_KEYS);
  if (s) return absolutizeLeafLinkMediaUrl(s);

  const topImage = row.image;
  if (typeof topImage === "string") {
    const t = cleanString(topImage);
    if (t && !t.startsWith("[object "))
      return absolutizeLeafLinkMediaUrl(t);
  }

  if (Array.isArray(row.images) && row.images[0]) {
    const img0 = asRecord(row.images[0]);
    s = pickString(img0, ["url", "image_url", "thumbnail_url", "src", "file"]);
    if (s) return absolutizeLeafLinkMediaUrl(s);
  }

  if (row.listing != null && typeof row.listing === "object" && !Array.isArray(row.listing)) {
    const l = asRecord(row.listing);
    s = pickString(l, LEAFLINK_IMAGE_URL_KEYS);
    if (s) return absolutizeLeafLinkMediaUrl(s);
    if (Array.isArray(l.images) && l.images[0]) {
      s = pickString(asRecord(l.images[0]), ["url", "image_url", "thumbnail_url", "src"]);
      if (s) return absolutizeLeafLinkMediaUrl(s);
    }
    const li = l.image;
    if (typeof li === "string") {
      const t = cleanString(li);
      if (t) return absolutizeLeafLinkMediaUrl(t);
    }
  }

  if (row.product != null && typeof row.product === "object" && !Array.isArray(row.product)) {
    const p = asRecord(row.product);
    s = pickString(p, LEAFLINK_IMAGE_URL_KEYS);
    if (s) return absolutizeLeafLinkMediaUrl(s);
    if (Array.isArray(p.images) && p.images[0]) {
      s = pickString(asRecord(p.images[0]), ["url", "image_url", "thumbnail_url"]);
      if (s) return absolutizeLeafLinkMediaUrl(s);
    }
  }

  return "";
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

/** LeafLink often sends FK ids (numbers) or `{ name, label }` instead of a plain string. */
function pickLeafLinkNestedLabel(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return cleanString(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    return "";
  }
  if (typeof v === "object" && !Array.isArray(v)) {
    const o = asRecord(v);
    return pickString(o, ["name", "display_name", "title", "label", "short_name"]);
  }
  return "";
}

function extractMoneyScalar(v: unknown): number | null {
  if (v == null)
    return null;
  if (typeof v === "number" && Number.isFinite(v))
    return v;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t)
      return null;
    const n = Number.parseFloat(t.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "object" && !Array.isArray(v)) {
    const o = asRecord(v);
    return extractMoneyScalar(o.amount ?? o.value ?? o.price ?? o.wholesale ?? o.unit_amount);
  }
  return null;
}

function moneyScalarAcceptable(key: string, n: number): boolean {
  if (!Number.isFinite(n) || n < 0) return false;
  /** LeafLink commonly sends `sale_price: { amount: 0 }` alongside real wholesale — ignore zero sale as “no price”. */
  if (key === "sale_price" && n === 0) return false;
  return true;
}

function pickPrice(row: Record<string, unknown>): number | null {
  const keys = [
    "wholesale_price",
    "price_schedule_price",
    "unit_price",
    "sale_price",
    "price",
    "retail_price",
    "minimum_price",
    "maximum_price",
    "listed_price",
    "product_price",
    "display_price",
  ];
  for (const k of keys) {
    const n = extractMoneyScalar(row[k]);
    if (n == null) continue;
    if (moneyScalarAcceptable(k, n)) return n;
  }
  const nestedPrice = asRecord(row.price);
  if (Object.keys(nestedPrice).length > 0) {
    const n = extractMoneyScalar(nestedPrice.amount ?? nestedPrice.value ?? nestedPrice);
    if (n != null && n >= 0) return n;
  }
  const pricing = asRecord(row.pricing);
  if (Object.keys(pricing).length > 0) {
    const n = extractMoneyScalar(pricing.wholesale ?? pricing.unit_price ?? pricing.price ?? pricing.retail);
    if (n != null && n >= 0) return n;
  }
  return null;
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
    const id = categoryString && isDigitsOnly(categoryString) ? categoryString : rawId || flat;
    /** Keep numeric categories as `Category #id` so product_type can surface as subcategory. */
    return id ? `Category #${id}` : typeGuess;
  }
  const direct = pickString(row, ["category", "category_name"]);
  return direct || typeGuess;
}

/**
 * When LeafLink sends the same `product_type` as the menu category (e.g. every line is "Live Resin Oil"),
 * real variants (510 thread vs disposable) often only appear in the merchandising title.
 */
function inferSubcategoryFromProductTitle(productName: string): string {
  const t = productName || "";
  if (!t.trim())
    return "";
  if (/\(\s*510\s*thread\s*\)|\b510\s*thread\b/i.test(t))
    return "510 thread";
  if (/\(\s*disposable\s*\)|\bdisposable\b/i.test(t))
    return "Disposable";
  if (/\*\s*New\s*Ceramic\s*\*/i.test(t) || /\(\s*ceramic\s*\)/i.test(t))
    return "Ceramic";
  if (/\bcartridge\b/i.test(t) && !/\b510\b/i.test(t))
    return "Cartridge";
  if (/\bpod\b/i.test(t))
    return "Pod";
  if (/\bpre[\s-]?rolls?\b/i.test(t))
    return "Pre-roll";
  return "";
}

/**
 * Product-style bucket under the menu category.
 * LeafLink v2 often stores `sub_category` / `product_line` as numeric FKs or nested `{ name }` objects — not plain strings.
 */
function pickSubcategoryDisplay(row: Record<string, unknown>, categoryDisplay: string): string {
  const fromNested =
    pickLeafLinkNestedLabel(row.sub_category) ||
    pickLeafLinkNestedLabel(row.subcategory) ||
    pickLeafLinkNestedLabel(row.product_line);
  if (fromNested) return fromNested;

  const explicit = pickString(row, [
    "subcategory",
    "sub_category_name",
    "sub_category_display",
    "product_subcategory",
    "subtype",
    "variety",
    "segment",
  ]);
  if (explicit && !isDigitsOnly(explicit)) return explicit;

  const typeGuess = pickString(row, [
    "product_type",
    "type",
    "product_type_display",
    "product_type_name",
    "product_class",
    "item_category",
  ]);
  const strainDisp = pickString(row, ["strain_classification_display", "strain_type_display"]);
  const strainUse =
    Boolean(strainDisp) &&
    !/^n\/?a$/i.test(strainDisp.trim()) &&
    !["na", "n/a"].includes(strainDisp.trim().toLowerCase());

  const catNorm = categoryDisplay.trim().toLowerCase();
  const typNorm = (typeGuess || "").trim().toLowerCase();
  const typeDistinct = Boolean(typeGuess && (!catNorm || typNorm !== catNorm));

  const parts: string[] = [];
  if (typeDistinct) parts.push(typeGuess);
  if (strainUse) parts.push(strainDisp);
  return parts.join(" · ");
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

export function pickListSource(raw: unknown): { list: unknown[]; source: string } {
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

function pickSellUnit(row: Record<string, unknown>): string {
  const direct = pickString(row, ["unit", "unit_of_measure", "sell_in_unit_of_measure", "uom"]);
  if (direct) return direct;
  const ud = row.unit_denomination;
  if (ud != null && typeof ud === "object" && !Array.isArray(ud)) {
    const o = asRecord(ud);
    const fromObj = pickString(o, ["name", "label", "display_name", "short_name"]);
    if (fromObj) return fromObj;
    const val = cleanString(o.value);
    if (val) return val;
  }
  return "";
}

/** Same row shaping as inventory sync; exported for tests. */
export function normalizeLeafLinkInventoryRows(raw: unknown): LeafLinkInventoryItem[] {
  const { list } = pickListSource(raw);
  const out: LeafLinkInventoryItem[] = [];
  for (const item of list as unknown[]) {
    const row = asRecord(item);
    const id = pickString(row, ["id", "inventory_id", "product_id", "sku"]);
    if (!id) continue;
    const availableQuantity = pickLeafLinkAvailableQuantity(row);
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
    const categoryDisplay = pickCategoryDisplay(row);
    const productTypeStr = pickString(row, ["product_type", "type"]);
    const subcategoryDisplay = pickSubcategoryDisplay(row, categoryDisplay);
    const titleVariant = inferSubcategoryFromProductTitle(productName);
    const apiBlend = (subcategoryDisplay || productTypeStr).trim();
    const subcategoryResolved = titleVariant || apiBlend;
    const listingRec =
      row.listing != null && typeof row.listing === "object" && !Array.isArray(row.listing)
        ? asRecord(row.listing)
        : null;
    const listingActiveDirect = pickTriStateBool(row, [
      "is_active",
      "active",
      "is_listed",
      "listed",
    ]);
    const listingActiveNested = listingRec
      ? pickTriStateBool(listingRec, ["is_active", "active", "is_listed", "listed"])
      : undefined;
    const listingActive =
      listingActiveDirect !== undefined ? listingActiveDirect : listingActiveNested;

    const wholesaleDirect = pickTriStateBool(row, [
      "available_for_wholesale",
      "sellable",
      "for_sale",
      "is_available_for_wholesale",
      "wholesale_available",
    ]);
    const wholesaleNested = listingRec
      ? pickTriStateBool(listingRec, [
          "available_for_wholesale",
          "sellable",
          "for_sale",
          "is_available_for_wholesale",
        ])
      : undefined;
    const wholesaleAvailable =
      wholesaleDirect !== undefined ? wholesaleDirect : wholesaleNested;

    const rowOut: LeafLinkInventoryItem = {
      id,
      productName,
      sku,
      strain: pickString(row, ["strain", "strain_name"]),
      category: categoryDisplay,
      productType: productTypeStr,
      subcategory: subcategoryResolved,
      brand: pickString(row, ["brand", "brand_name", "vendor_name"]),
      availableQuantity,
      unit: pickSellUnit(row),
      packageSize: pickString(row, ["package_size", "size", "unit_multiplier"]),
      price: pickPrice(row),
      status: pickString(row, ["status", "availability", "state", "listing_state", "display_listing_state"]),
      updatedAt: pickString(row, ["updated_at", "updatedAt", "modified_at", "modified", "last_edit"]),
      imageUrl: pickLeafLinkImageUrl(row),
      sourcePackageGroup: deriveSourcePackageGroup(sku, productName),
    };
    if (listingActive !== undefined) rowOut.listingActive = listingActive;
    if (wholesaleAvailable !== undefined) rowOut.wholesaleAvailable = wholesaleAvailable;
    out.push(rowOut);
  }
  return out;
}

export async function fetchJsonWithRetry(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
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
        let leafLinkDetail = "";
        if (isJson && trimmed) {
          try {
            const parsed: unknown = JSON.parse(trimmed);
            leafLinkDetail = leafLinkErrorDetailFromBody(parsed);
          }
          catch {
            /* ignore */
          }
        }
        const suffix = leafLinkDetail ? ` ${leafLinkDetail}` : "";
        throw new AppError(`LeafLink request failed (${res.status}).${suffix}`, 502, "LEAFLINK_REQUEST_FAILED", {
          status: res.status,
          leafLinkDetail: leafLinkDetail || undefined,
        });
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
      const isFinalAttempt = i === 1;
      const logPayload = {
        url,
        attempt: i + 1,
        finalAttempt: isFinalAttempt,
        error: error instanceof Error ? error.message : String(error),
      };
      logInfo(
        isFinalAttempt ? "[LEAFLINK] request_attempt_failed_final" : "[LEAFLINK] request_attempt_failed_retrying",
        logPayload,
      );
      if (i === 1) throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("LeafLink request failed");
}

async function fetchLeafLinkInventoryFromApi(
  creds: LeafLinkRuntimeCredentials,
  authSource: LeafLinkCredentialSource,
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
  const authCandidates = buildLeafLinkAuthCandidates(creds);

  let payload: unknown = null;
  let usedEndpoint = "";
  let usedAuthMode = "";
  let successInit: RequestInit | null = null;
  let lastErr: unknown = null;
  outer: for (const endpoint of endpointCandidates) {
    for (const authValue of authCandidates) {
      const authMode = leafLinkAuthMode(authValue);
      const leafLinkInit: RequestInit = {
        method: "GET",
        headers: buildLeafLinkHeaders(creds, authValue),
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
          logInfo("[LEAFLINK] auth_fallback_attempt", {
            companyId: creds.companyId || null,
            authSource,
            authMode,
            endpoint: endpoint.slice(0, 220),
            fallbackTriggered: true,
            reasonCode: code || "UNKNOWN",
            reason: error instanceof Error ? error.message : String(error),
          });
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
    companyId: creds.companyId || null,
    authSource,
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

  const items = normalizeLeafLinkInventoryRows(mergedPayload);
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
    logInfo("[LEAFLINK] credentials_resolved", {
      companyId,
      authSource: creds.source,
      fromDb: creds.source === "db",
      fromEnv: creds.source === "env",
    });
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
      fetchLeafLinkInventoryFromApi(creds, creds.source, modifiedGte, debug);

    let pull: Awaited<ReturnType<typeof fetchLeafLinkInventoryFromApi>>;
    let usedIncremental = Boolean(incrementalSince);
    try {
      pull = await runPull(incrementalSince);
    }
    catch (firstErr) {
      if (incrementalSince) {
        logInfo("[LEAFLINK] incremental_pull_retry_full", {
          companyId,
          authSource: creds.source,
          fallbackTriggered: true,
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

