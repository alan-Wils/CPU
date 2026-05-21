import axios, { type AxiosError, type AxiosRequestConfig } from "axios";
import { logInfo, logWarn } from "./logger.js";
import { resolveMetrcApiBaseUrl, type MetrcEnvironment } from "./metrcResolveBaseUrl.js";

const MIN_INTERVAL_MS = 200;
const MAX_TRANSPORT_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 25_000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const AUTH_DENIED_STATUSES = new Set([401, 403]);

let rateChain: Promise<void> = Promise.resolve();

/** Per-company cache of the last successful authenticated request strategy. */
const companyAuthModeCache = new Map<string, MetrcClientAuthMode>();

export type MetrcClientAuthMode =
  | "basic_metrc_user"
  | "basic_any_user"
  | "bearer_user_vendor";

export type MetrcAuthModeLog = {
  auth_mode: MetrcClientAuthMode;
  usesVendorHeader: boolean;
  usesBasicAuth: boolean;
  basicUsernameLabel: string | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireRateSlot(companyId?: string): Promise<number> {
  let waitedMs = 0;
  const run = async () => {
    const now = Date.now();
    const nextSlot = (globalThis as { __metrcLastSlotAt?: number }).__metrcLastSlotAt ?? 0;
    const wait = Math.max(0, nextSlot + MIN_INTERVAL_MS - now);
    if (wait > 0) {
      waitedMs = wait;
      logWarn("[METRC] rate_limit_wait", { companyId: companyId ?? null, waitedMs });
      await sleep(wait);
    }
    (globalThis as { __metrcLastSlotAt?: number }).__metrcLastSlotAt = Date.now();
  };
  const prev = rateChain;
  rateChain = prev.then(run, run);
  await rateChain;
  return waitedMs;
}

export type MetrcClientCredentials = {
  environment: MetrcEnvironment;
  stateCode: string;
  apiBaseUrlOverride?: string;
  vendorApiKey: string;
  userApiKey: string;
  username: string;
  licenseNumber: string;
};

export type MetrcClientSuccess<T> = {
  ok: true;
  status: number;
  data: T;
  durationMs: number;
  retries: number;
  rateLimitWaitedMs: number;
  authMode: MetrcClientAuthMode | "vendor_only";
};

export type MetrcUpstreamError = {
  upstream: "metrc";
  type: "html_runtime_error";
  endpoint: string;
  status: number;
};

export const METRC_HTML_RUNTIME_USER_MESSAGE =
  "METRC sandbox returned a server/runtime error for this endpoint.";

export type MetrcClientFailure = {
  ok: false;
  status: number;
  message: string;
  durationMs: number;
  retries: number;
  rateLimitWaitedMs: number;
  attemptedAuthModes: MetrcClientAuthMode[];
  endpoint?: string;
  upstreamError?: MetrcUpstreamError;
};

export type MetrcClientResult<T> = MetrcClientSuccess<T> | MetrcClientFailure;

export function isMetrcClientFailure<T>(r: MetrcClientResult<T>): r is MetrcClientFailure {
  return r.ok === false;
}

/** Safe description for logs — never includes keys or passwords. */
export function describeMetrcAuthMode(mode: MetrcClientAuthMode): MetrcAuthModeLog {
  switch (mode) {
    case "basic_metrc_user":
      return {
        auth_mode: mode,
        usesVendorHeader: true,
        usesBasicAuth: true,
        basicUsernameLabel: "metrc",
      };
    case "basic_any_user":
      return {
        auth_mode: mode,
        usesVendorHeader: true,
        usesBasicAuth: true,
        basicUsernameLabel: "any",
      };
    case "bearer_user_vendor":
      return {
        auth_mode: mode,
        usesVendorHeader: true,
        usesBasicAuth: false,
        basicUsernameLabel: null,
      };
    default:
      return {
        auth_mode: mode,
        usesVendorHeader: false,
        usesBasicAuth: false,
        basicUsernameLabel: null,
      };
  }
}

export function buildMetrcClientAuthPlan(
  companyId: string | undefined,
  hasVendorKey: boolean,
): MetrcClientAuthMode[] {
  const base: MetrcClientAuthMode[] = hasVendorKey
    ? ["basic_metrc_user", "basic_any_user", "bearer_user_vendor"]
    : ["bearer_user_vendor", "basic_metrc_user", "basic_any_user"];

  if (!companyId) return base;
  const cached = companyAuthModeCache.get(companyId);
  if (cached && base.includes(cached)) {
    return [cached, ...base.filter((m) => m !== cached)];
  }
  return base;
}

export function cacheMetrcAuthModeForCompany(companyId: string, mode: MetrcClientAuthMode): void {
  companyAuthModeCache.set(companyId, mode);
}

export function getCachedMetrcAuthMode(companyId: string): MetrcClientAuthMode | null {
  return companyAuthModeCache.get(companyId) ?? null;
}

/** @internal test helper */
export function clearMetrcClientAuthCache(): void {
  companyAuthModeCache.clear();
}

function buildAuthHeadersForMode(
  mode: MetrcClientAuthMode,
  creds: MetrcClientCredentials,
): Record<string, string> | null {
  const userKey = creds.userApiKey.trim();
  if (!userKey) return null;

  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "CPU-NexBatch/1.0",
  };

  const vendor = creds.vendorApiKey.trim();
  if (vendor) headers["x-metrc-key"] = vendor;

  switch (mode) {
    case "basic_metrc_user":
      headers.Authorization = `Basic ${Buffer.from(`metrc:${userKey}`, "utf8").toString("base64")}`;
      return headers;
    case "basic_any_user":
      headers.Authorization = `Basic ${Buffer.from(`any:${userKey}`, "utf8").toString("base64")}`;
      return headers;
    case "bearer_user_vendor":
      headers.Authorization = `Bearer ${userKey}`;
      return headers;
    default:
      return null;
  }
}

function buildVendorOnlyHeaders(creds: MetrcClientCredentials): Record<string, string> {
  return {
    Accept: "application/json",
    "User-Agent": "CPU-NexBatch/1.0",
    ...(creds.vendorApiKey.trim() ? { "x-metrc-key": creds.vendorApiKey.trim() } : {}),
  };
}

function resolveRetryAfterMs(error: AxiosError): number | null {
  const raw = error.response?.headers?.["retry-after"];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v == null) return null;
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return Math.min(n * 1000, 60_000);
  const d = Date.parse(String(v));
  if (Number.isFinite(d)) return Math.max(0, Math.min(d - Date.now(), 60_000));
  return null;
}

export function isMetrcHtmlContentType(contentType: string | null | undefined): boolean {
  return String(contentType || "").toLowerCase().includes("text/html");
}

export function looksLikeHtmlBody(data: unknown): boolean {
  if (typeof data !== "string") return false;
  const t = data.trim().toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html") || t.includes("<html");
}

export function detectMetrcHtmlResponse(contentType: string | null, data: unknown): boolean {
  return isMetrcHtmlContentType(contentType) || looksLikeHtmlBody(data);
}

export function metrcHtmlBodySnippet(data: unknown, maxLen = 200): string {
  if (typeof data !== "string") return "";
  return data.slice(0, maxLen);
}

function resolveResponseContentType(headers: unknown): string | null {
  if (!headers || typeof headers !== "object") return null;
  const h = headers as Record<string, unknown>;
  const raw = h["content-type"] ?? h["Content-Type"];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v != null ? String(v) : null;
}

function buildMetrcHtmlRuntimeFailure(input: {
  pathLabel: string;
  status: number;
  contentType: string | null;
  data: unknown;
  durationMs: number;
  retries: number;
  rateLimitWaitedMs: number;
  attemptedAuthModes: MetrcClientAuthMode[];
  companyId?: string;
}): MetrcClientFailure {
  logWarn("[METRC] html_error_response", {
    companyId: input.companyId ?? null,
    endpoint: input.pathLabel,
    status: input.status,
    contentType: input.contentType,
    bodySnippet: metrcHtmlBodySnippet(input.data),
  });
  return {
    ok: false,
    status: input.status || 502,
    message: METRC_HTML_RUNTIME_USER_MESSAGE,
    durationMs: input.durationMs,
    retries: input.retries,
    rateLimitWaitedMs: input.rateLimitWaitedMs,
    attemptedAuthModes: input.attemptedAuthModes,
    endpoint: input.pathLabel,
    upstreamError: {
      upstream: "metrc",
      type: "html_runtime_error",
      endpoint: input.pathLabel,
      status: input.status || 502,
    },
  };
}

function summarizeResponseMessage(status: number, data: unknown): string {
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (looksLikeHtmlBody(trimmed)) return METRC_HTML_RUNTIME_USER_MESSAGE;
    if (trimmed) return trimmed.slice(0, 2000);
  }
  if (Array.isArray(data) && data.length) {
    const first = data[0] as { message?: string };
    if (first?.message) return String(first.message).slice(0, 2000);
  }
  if (data && typeof data === "object") {
    const msg = (data as { Message?: string; message?: string }).Message
      ?? (data as { message?: string }).message;
    if (msg) return String(msg).slice(0, 2000);
  }
  return `METRC returned HTTP ${status}.`;
}

function summarizeAxiosError(error: AxiosError): { status: number; message: string } {
  const status = error.response?.status ?? 0;
  const data = error.response?.data;
  if (typeof data === "string" && data.trim()) {
    return { status, message: data.trim().slice(0, 2000) };
  }
  if (Array.isArray(data) && data.length) {
    const first = data[0] as { message?: string };
    if (first?.message) return { status, message: String(first.message).slice(0, 2000) };
  }
  if (data && typeof data === "object") {
    const msg = (data as { Message?: string; message?: string }).Message
      ?? (data as { message?: string }).message;
    if (msg) return { status, message: String(msg).slice(0, 2000) };
  }
  if (error.code === "ECONNABORTED" || error.message?.toLowerCase().includes("timeout")) {
    return { status: 0, message: "METRC request timed out." };
  }
  return { status, message: error.message || "METRC request failed." };
}

async function axiosOnce<T>(config: AxiosRequestConfig): Promise<{
  res: { status: number; data: T; contentType: string | null };
  transportError: { status: number; message: string } | null;
}> {
  try {
    const res = await axios.request<T>(config);
    return {
      res: {
        status: res.status,
        data: res.data,
        contentType: resolveResponseContentType(res.headers),
      },
      transportError: null,
    };
  } catch (error) {
    const ax = axios.isAxiosError(error) ? error : null;
    if (ax) {
      const { status, message } = summarizeAxiosError(ax);
      return {
        res: {
          status,
          data: ax.response?.data as T,
          contentType: resolveResponseContentType(ax.response?.headers),
        },
        transportError: { status, message },
      };
    }
    return {
      res: { status: 0, data: undefined as T, contentType: null },
      transportError: {
        status: 0,
        message: error instanceof Error ? error.message : "METRC request failed.",
      },
    };
  }
}

export class MetrcClient {
  readonly baseUrl: string | null;

  constructor(
    private readonly creds: MetrcClientCredentials,
    private readonly companyId?: string,
  ) {
    this.baseUrl = resolveMetrcApiBaseUrl({
      stateCode: creds.stateCode,
      environment: creds.environment,
      apiBaseUrlOverride: creds.apiBaseUrlOverride,
    });
  }

  static fromLoadedConfig(
    loaded: {
      vendorApiKey: string;
      userApiKey: string;
      username: string;
      licenseNumber: string;
      stateCode: string;
      environment: MetrcEnvironment;
      apiBaseUrlOverride: string;
    },
    companyId?: string,
  ): MetrcClient {
    return new MetrcClient(
      {
        environment: loaded.environment,
        stateCode: loaded.stateCode,
        apiBaseUrlOverride: loaded.apiBaseUrlOverride,
        vendorApiKey: loaded.vendorApiKey,
        userApiKey: loaded.userApiKey,
        username: loaded.username,
        licenseNumber: loaded.licenseNumber,
      },
      companyId,
    );
  }

  async request<T = unknown>(input: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    pathnameAndQuery: string;
    body?: unknown;
    absoluteUrl?: string;
    vendorOnly?: boolean;
  }): Promise<MetrcClientResult<T>> {
    const path = String(input.pathnameAndQuery || "").trim();
    const url = input.absoluteUrl
      ?? (this.baseUrl && path.startsWith("/") ? `${this.baseUrl.replace(/\/+$/, "")}${path}` : null);

    if (!url) {
      return {
        ok: false,
        status: 400,
        message: "METRC base URL is not configured. Set state code or API base URL override.",
        durationMs: 0,
        retries: 0,
        rateLimitWaitedMs: 0,
        attemptedAuthModes: [],
      };
    }

    const pathLabel = path.split("?")[0] || input.absoluteUrl?.split("/").slice(-3).join("/");
    const t0 = Date.now();
    let transportRetries = 0;
    let totalRateWait = 0;

    if (input.absoluteUrl || input.vendorOnly) {
      return this.requestSingleStrategy<T>({
        url,
        method: input.method,
        body: input.body,
        headers: buildVendorOnlyHeaders(this.creds),
        pathLabel,
        t0,
        authMode: "vendor_only",
      });
    }

    if (!this.creds.userApiKey.trim()) {
      return {
        ok: false,
        status: 400,
        message: "User API key is required for METRC requests.",
        durationMs: 0,
        retries: 0,
        rateLimitWaitedMs: 0,
        attemptedAuthModes: [],
      };
    }

    const hasVendor = Boolean(this.creds.vendorApiKey.trim());
    const authPlan = buildMetrcClientAuthPlan(this.companyId, hasVendor);
    const attemptedAuthModes: MetrcClientAuthMode[] = [];
    let lastStatus = 0;
    let lastMessage = "METRC authorization failed.";

    for (const mode of authPlan) {
      const headers = buildAuthHeadersForMode(mode, this.creds);
      if (!headers) continue;

      attemptedAuthModes.push(mode);
      const authLog = describeMetrcAuthMode(mode);

      logInfo("[METRC] auth_strategy_attempt", {
        companyId: this.companyId ?? null,
        path: pathLabel,
        ...authLog,
      });
      logInfo("[METRC] auth_mode", {
        companyId: this.companyId ?? null,
        ...authLog,
      });

      let modeTransportRetries = 0;

      while (modeTransportRetries <= MAX_TRANSPORT_RETRIES) {
        const rateLimitWaitedMs = await acquireRateSlot(this.companyId);
        totalRateWait += rateLimitWaitedMs;

        const config: AxiosRequestConfig = {
          method: input.method,
          url,
          headers:
            input.body !== undefined && input.method !== "GET"
              ? { ...headers, "Content-Type": "application/json" }
              : headers,
          timeout: REQUEST_TIMEOUT_MS,
          validateStatus: () => true,
        };
        if (input.body !== undefined && input.method !== "GET") {
          config.data = input.body;
        }

        logInfo("[METRC] request_start", {
          companyId: this.companyId ?? null,
          method: input.method,
          path: pathLabel,
          auth_mode: mode,
          attempt: modeTransportRetries + 1,
        });

        const { res, transportError } = await axiosOnce<T>(config);
        const durationMs = Math.max(0, Date.now() - t0);

        if (transportError && transportError.status === 0) {
          logWarn("[METRC] request_error", {
            companyId: this.companyId ?? null,
            path: pathLabel,
            auth_mode: mode,
            message: transportError.message.slice(0, 500),
          });
          if (modeTransportRetries < MAX_TRANSPORT_RETRIES) {
            modeTransportRetries += 1;
            transportRetries += 1;
            await sleep(500 * modeTransportRetries);
            continue;
          }
          return {
            ok: false,
            status: 0,
            message: transportError.message,
            durationMs,
            retries: transportRetries,
            rateLimitWaitedMs: totalRateWait,
            attemptedAuthModes,
          };
        }

        logInfo("[METRC] request_complete", {
          companyId: this.companyId ?? null,
          method: input.method,
          path: pathLabel,
          status: res.status,
          auth_mode: mode,
          durationMs,
          transportRetries: modeTransportRetries,
          rateLimitWaitedMs: totalRateWait,
        });

        if (detectMetrcHtmlResponse(res.contentType, res.data)) {
          return buildMetrcHtmlRuntimeFailure({
            pathLabel,
            status: res.status,
            contentType: res.contentType,
            data: res.data,
            durationMs,
            retries: transportRetries,
            rateLimitWaitedMs: totalRateWait,
            attemptedAuthModes,
            companyId: this.companyId,
          });
        }

        if (res.status >= 200 && res.status < 300) {
          if (this.companyId) cacheMetrcAuthModeForCompany(this.companyId, mode);
          logInfo("[METRC] auth_strategy_success", {
            companyId: this.companyId ?? null,
            path: pathLabel,
            ...authLog,
            status: res.status,
          });
          return {
            ok: true,
            status: res.status,
            data: res.data,
            durationMs,
            retries: transportRetries,
            rateLimitWaitedMs: totalRateWait,
            authMode: mode,
          };
        }

        lastStatus = res.status;
        lastMessage = summarizeResponseMessage(res.status, res.data);

        if (AUTH_DENIED_STATUSES.has(res.status)) {
          logWarn("[METRC] auth_strategy_denied", {
            companyId: this.companyId ?? null,
            path: pathLabel,
            auth_mode: mode,
            status: res.status,
            message: lastMessage.slice(0, 200),
          });
          break;
        }

        if (RETRYABLE_STATUSES.has(res.status) && modeTransportRetries < MAX_TRANSPORT_RETRIES) {
          modeTransportRetries += 1;
          transportRetries += 1;
          const backoff = res.status === 429 ? 1000 * modeTransportRetries : 500 * modeTransportRetries;
          logWarn("[METRC] request_retry", {
            companyId: this.companyId ?? null,
            path: pathLabel,
            auth_mode: mode,
            status: res.status,
            retry: modeTransportRetries,
            backoffMs: backoff,
          });
          await sleep(backoff);
          continue;
        }

        return {
          ok: false,
          status: res.status,
          message: lastMessage,
          durationMs,
          retries: transportRetries,
          rateLimitWaitedMs: totalRateWait,
          attemptedAuthModes,
          endpoint: pathLabel,
        };
      }
    }

    logWarn("[METRC] auth_strategy_failed_all_modes", {
      companyId: this.companyId ?? null,
      path: pathLabel,
      attemptedAuthModes,
      lastStatus,
    });

    return {
      ok: false,
      status: lastStatus || 401,
      message: lastMessage,
      durationMs: Math.max(0, Date.now() - t0),
      retries: transportRetries,
      rateLimitWaitedMs: totalRateWait,
      attemptedAuthModes,
      endpoint: pathLabel,
    };
  }

  private async requestSingleStrategy<T>(input: {
    url: string;
    method: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
    headers: Record<string, string>;
    pathLabel: string;
    t0: number;
    authMode: "vendor_only";
  }): Promise<MetrcClientResult<T>> {
    let retries = 0;
    let totalRateWait = 0;

    while (true) {
      const rateLimitWaitedMs = await acquireRateSlot(this.companyId);
      totalRateWait += rateLimitWaitedMs;

      const config: AxiosRequestConfig = {
        method: input.method,
        url: input.url,
        headers:
          input.body !== undefined && input.method !== "GET"
            ? { ...input.headers, "Content-Type": "application/json" }
            : input.headers,
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: () => true,
      };
      if (input.body !== undefined && input.method !== "GET") {
        config.data = input.body;
      }

      logInfo("[METRC] request_start", {
        companyId: this.companyId ?? null,
        method: input.method,
        path: input.pathLabel,
        auth_mode: input.authMode,
        attempt: retries + 1,
      });

      const { res, transportError } = await axiosOnce<T>(config);
      const durationMs = Math.max(0, Date.now() - input.t0);

      logInfo("[METRC] request_complete", {
        companyId: this.companyId ?? null,
        method: input.method,
        path: input.pathLabel,
        status: transportError?.status ?? res.status,
        auth_mode: input.authMode,
        durationMs,
        retries,
      });

      if (transportError && transportError.status === 0) {
        if (retries < MAX_TRANSPORT_RETRIES) {
          retries += 1;
          await sleep(500 * retries);
          continue;
        }
        return {
          ok: false,
          status: 0,
          message: transportError.message,
          durationMs,
          retries,
          rateLimitWaitedMs: totalRateWait,
          attemptedAuthModes: [],
        };
      }

      if (detectMetrcHtmlResponse(res.contentType, res.data)) {
        return buildMetrcHtmlRuntimeFailure({
          pathLabel: input.pathLabel,
          status: res.status,
          contentType: res.contentType,
          data: res.data,
          durationMs,
          retries,
          rateLimitWaitedMs: totalRateWait,
          attemptedAuthModes: [],
          companyId: this.companyId,
        });
      }

      if (res.status >= 200 && res.status < 300) {
        return {
          ok: true,
          status: res.status,
          data: res.data,
          durationMs,
          retries,
          rateLimitWaitedMs: totalRateWait,
          authMode: input.authMode,
        };
      }

      if (RETRYABLE_STATUSES.has(res.status) && retries < MAX_TRANSPORT_RETRIES) {
        retries += 1;
        await sleep(res.status === 429 ? 1000 * retries : 500 * retries);
        continue;
      }

      return {
        ok: false,
        status: res.status,
        message: summarizeResponseMessage(res.status, res.data),
        durationMs,
        retries,
        rateLimitWaitedMs: totalRateWait,
        attemptedAuthModes: [],
        endpoint: input.pathLabel,
      };
    }
  }

  get<T = unknown>(pathnameAndQuery: string): Promise<MetrcClientResult<T>> {
    return this.request<T>({ method: "GET", pathnameAndQuery });
  }

  post<T = unknown>(pathnameAndQuery: string, body?: unknown): Promise<MetrcClientResult<T>> {
    return this.request<T>({ method: "POST", pathnameAndQuery, body });
  }
}

/** CO sandbox integrator setup host (per METRC sandbox docs). */
export function resolveSandboxIntegratorSetupUrl(stateCode: string): string | null {
  const st = String(stateCode || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(st)) return null;
  return `https://sandbox-api-${st.toLowerCase()}.metrc.com/sandbox/v2/integrator/setup`;
}
