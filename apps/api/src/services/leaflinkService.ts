import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";
import { logInfo, logWarn } from "../lib/logger.js";
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
};

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

function pickPrice(row: Record<string, unknown>): number | null {
  const direct = pickNumber(row, ["price", "unit_price", "sale_price", "wholesale_price"]);
  if (direct > 0) return direct;
  const nested = asRecord(row.price);
  const nestedVal = pickNumber(nested, ["amount", "value"]);
  return nestedVal > 0 ? nestedVal : null;
}

function normalizeRows(raw: unknown): LeafLinkInventoryItem[] {
  const root = asRecord(raw);
  const list =
    (Array.isArray(root.data) && root.data) ||
    (Array.isArray(root.results) && root.results) ||
    (Array.isArray(root.items) && root.items) ||
    (Array.isArray(raw) ? raw : []);
  const out: LeafLinkInventoryItem[] = [];
  for (const item of list as unknown[]) {
    const row = asRecord(item);
    const id = pickString(row, ["id", "inventory_id", "product_id", "sku"]);
    if (!id) continue;
    const availableQuantity = pickNumber(row, ["available_quantity", "quantity_available", "quantity", "available"]);
    const status = pickString(row, ["status", "availability", "state"]).toLowerCase();
    const likelyAvailable =
      availableQuantity > 0 ||
      status.includes("available") ||
      status.includes("active") ||
      status.includes("in_stock");
    if (!likelyAvailable) continue;
    out.push({
      id,
      productName: pickString(row, ["product_name", "name", "title"]),
      sku: pickString(row, ["sku", "product_sku"]),
      strain: pickString(row, ["strain", "strain_name"]),
      category: pickString(row, ["category", "category_name"]),
      productType: pickString(row, ["product_type", "type"]),
      brand: pickString(row, ["brand", "brand_name", "vendor_name"]),
      availableQuantity,
      unit: pickString(row, ["unit", "unit_of_measure", "uom"]),
      packageSize: pickString(row, ["package_size", "size"]),
      price: pickPrice(row),
      status: pickString(row, ["status", "availability", "state"]),
      updatedAt: pickString(row, ["updated_at", "updatedAt", "modified_at"]),
      imageUrl: pickString(row, ["image_url", "image", "thumbnail_url"]),
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

export class LeafLinkInventoryService {
  leafLinkService = new LeafLinkService();

  async fetchAvailableInventory(companyId: string): Promise<LeafLinkInventoryResponse> {
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

    const base = creds.baseUrl.replace(/\/+$/, "");
    const endpoint = `${base}/inventories?company_id=${encodeURIComponent(creds.companyId)}&available=true`;
    const payload = await fetchJsonWithRetry(
      endpoint,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${creds.apiKey}`,
          "X-API-KEY": creds.apiKey,
          "x-api-key": creds.apiKey,
          "X-Company-Slug": creds.companySlug,
          "X-LeafLink-Company-Id": creds.companyId,
        },
      },
      15_000,
    );

    const items = normalizeRows(payload);
    const categories = new Set(items.map((x) => x.category).filter(Boolean));
    const totalInventoryUnits = items.reduce((sum, row) => sum + toNumber(row.availableQuantity), 0);
    const totalInventoryValue = items.reduce((sum, row) => {
      const p = row.price == null ? 0 : toNumber(row.price);
      return sum + p * toNumber(row.availableQuantity);
    }, 0);
    return {
      source: "leaflink",
      items,
      stats: {
        totalSkus: items.length,
        totalInventoryUnits,
        totalInventoryValue,
        categoriesCount: categories.size,
      },
      lastSyncedAt: new Date().toISOString(),
    };
  }
}

