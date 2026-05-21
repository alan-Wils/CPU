import axios, { type AxiosError, type AxiosRequestConfig } from "axios";
import { env } from "../config/env.js";
import { logInfo, logWarn } from "./logger.js";
import { resolveMetrcApiBaseUrl, type MetrcEnvironment } from "./metrcResolveBaseUrl.js";

const MIN_INTERVAL_MS = 200;
const MAX_TRANSPORT_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 25_000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

let rateChain: Promise<void> = Promise.resolve();

export type MetrcClientAuthMode = "basic_vendor_user" | "vendor_only";

export type MetrcAuthModeLog = {
  auth_mode: MetrcClientAuthMode;
  usesBasicAuth: boolean;
  usesVendorUserPair: boolean;
};

export function describeMetrcAuthMode(mode: MetrcClientAuthMode): MetrcAuthModeLog {
  return {
    auth_mode: mode,
    usesBasicAuth: true,
    usesVendorUserPair: mode === "basic_vendor_user",
  };
}

/** @deprecated Single auth mode; kept for callers that referenced an auth plan. */
export function buildMetrcClientAuthPlan(): MetrcClientAuthMode[] {
  return ["basic_vendor_user"];
}

/** @deprecated No-op — auth mode is fixed. */
export function cacheMetrcAuthModeForCompany(_companyId: string, _mode: MetrcClientAuthMode): void {}

/** @deprecated No-op — auth mode is fixed. */
export function getCachedMetrcAuthMode(_companyId: string): MetrcClientAuthMode | null {
  return "basic_vendor_user";
}

/** @internal test helper */
export function clearMetrcClientAuthCache(): void {}

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
  authMode: MetrcClientAuthMode;
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

/** Colorado sandbox: Basic base64("{vendorApiKey}:{userApiKey}"). */
export function buildBasicVendorUserAuthorization(vendorApiKey: string, userApiKey: string): string {
  const auth = Buffer.from(`${vendorApiKey}:${userApiKey}`, "utf8").toString("base64");
  return `Basic ${auth}`;
}

function buildMetrcRequestHeaders(
  creds: MetrcClientCredentials,
  vendorOnly: boolean,
): { headers: Record<string, string>; authMode: MetrcClientAuthMode } | null {
  const vendor = creds.vendorApiKey.trim();
  const user = creds.userApiKey.trim();

  const base: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "CPU-NexBatch/1.0",
  };

  if (vendorOnly) {
    if (!vendor) return null;
    const authorization = user
      ? buildBasicVendorUserAuthorization(vendor, user)
      : `Basic ${Buffer.from(`${vendor}:`, "utf8").toString("base64")}`;
    return {
      authMode: "vendor_only",
      headers: { ...base, Authorization: authorization },
    };
  }

  if (!vendor || !user) return null;
  return {
    authMode: "basic_vendor_user",
    headers: {
      ...base,
      Authorization: buildBasicVendorUserAuthorization(vendor, user),
    },
  };
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

function formatBodyForDevLog(data: unknown): string {
  if (typeof data === "string") return data.slice(0, 4000);
  if (data == null) return "";
  try {
    return JSON.stringify(data).slice(0, 4000);
  } catch {
    return "[unserializable response body]";
  }
}

function logMetrcResponseBodyDev(parts: {
  pathLabel: string;
  status: number;
  contentType: string | null;
  data: unknown;
}): void {
  if (env.NODE_ENV === "production") return;
  logInfo("[METRC] response_body_dev", {
    endpoint: parts.pathLabel,
    status: parts.status,
    contentType: parts.contentType,
    body: formatBodyForDevLog(parts.data),
  });
}

function buildMetrcHtmlRuntimeFailure(input: {
  pathLabel: string;
  status: number;
  contentType: string | null;
  data: unknown;
  durationMs: number;
  retries: number;
  rateLimitWaitedMs: number;
  authMode: MetrcClientAuthMode;
  companyId?: string;
}): MetrcClientFailure {
  logWarn("[METRC] html_error_response", {
    companyId: input.companyId ?? null,
    endpoint: input.pathLabel,
    status: input.status,
    contentType: input.contentType,
    bodySnippet: metrcHtmlBodySnippet(input.data),
  });
  logMetrcResponseBodyDev({
    pathLabel: input.pathLabel,
    status: input.status,
    contentType: input.contentType,
    data: input.data,
  });
  return {
    ok: false,
    status: input.status || 502,
    message: METRC_HTML_RUNTIME_USER_MESSAGE,
    durationMs: input.durationMs,
    retries: input.retries,
    rateLimitWaitedMs: input.rateLimitWaitedMs,
    attemptedAuthModes: [input.authMode],
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
  const safeConfig: AxiosRequestConfig = { ...config, auth: undefined };
  try {
    const res = await axios.request<T>(safeConfig);
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

    const pathLabel =
      path.split("?")[0]
      || input.absoluteUrl?.split("/").slice(-3).join("/")
      || path;
    const t0 = Date.now();
    const vendorOnly = Boolean(input.absoluteUrl || input.vendorOnly);

    if (!vendorOnly && !this.creds.userApiKey.trim()) {
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

    if (!this.creds.vendorApiKey.trim()) {
      return {
        ok: false,
        status: 400,
        message: "Vendor API key is required for METRC requests.",
        durationMs: 0,
        retries: 0,
        rateLimitWaitedMs: 0,
        attemptedAuthModes: [],
      };
    }

    const built = buildMetrcRequestHeaders(this.creds, vendorOnly);
    if (!built) {
      return {
        ok: false,
        status: 400,
        message: vendorOnly
          ? "Vendor API key is required."
          : "Vendor and user API keys are required for METRC requests.",
        durationMs: 0,
        retries: 0,
        rateLimitWaitedMs: 0,
        attemptedAuthModes: [],
      };
    }

    const { headers, authMode } = built;
    const authLog = describeMetrcAuthMode(authMode);

    logInfo("[METRC] auth_mode", {
      companyId: this.companyId ?? null,
      auth_mode: authMode,
      ...authLog,
    });

    let transportRetries = 0;
    let totalRateWait = 0;

    while (transportRetries <= MAX_TRANSPORT_RETRIES) {
      const rateLimitWaitedMs = await acquireRateSlot(this.companyId);
      totalRateWait += rateLimitWaitedMs;

      const config: AxiosRequestConfig = {
        method: input.method,
        url,
        headers,
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: () => true,
        auth: undefined,
      };
      if (input.body !== undefined && input.method !== "GET") {
        config.data = input.body;
      }

      logInfo("[METRC] request_start", {
        companyId: this.companyId ?? null,
        method: input.method,
        path: pathLabel,
        auth_mode: authMode,
        attempt: transportRetries + 1,
      });

      const { res, transportError } = await axiosOnce<T>(config);
      const durationMs = Math.max(0, Date.now() - t0);

      logMetrcResponseBodyDev({
        pathLabel,
        status: transportError?.status ?? res.status,
        contentType: res.contentType,
        data: res.data,
      });

      if (transportError && transportError.status === 0) {
        logWarn("[METRC] request_error", {
          companyId: this.companyId ?? null,
          path: pathLabel,
          auth_mode: authMode,
          message: transportError.message.slice(0, 500),
        });
        if (transportRetries < MAX_TRANSPORT_RETRIES) {
          transportRetries += 1;
          await sleep(500 * transportRetries);
          continue;
        }
        return {
          ok: false,
          status: 0,
          message: transportError.message,
          durationMs,
          retries: transportRetries,
          rateLimitWaitedMs: totalRateWait,
          attemptedAuthModes: [authMode],
          endpoint: pathLabel,
        };
      }

      logInfo("[METRC] request_complete", {
        companyId: this.companyId ?? null,
        method: input.method,
        path: pathLabel,
        status: res.status,
        auth_mode: authMode,
        durationMs,
        transportRetries,
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
          authMode,
          companyId: this.companyId,
        });
      }

      if (res.status >= 200 && res.status < 300) {
        logInfo("[METRC] auth_strategy_success", {
          companyId: this.companyId ?? null,
          path: pathLabel,
          auth_mode: authMode,
          status: res.status,
        });
        return {
          ok: true,
          status: res.status,
          data: res.data,
          durationMs,
          retries: transportRetries,
          rateLimitWaitedMs: totalRateWait,
          authMode,
        };
      }

      const message = summarizeResponseMessage(res.status, res.data);

      if (res.status === 401 || res.status === 403) {
        logWarn("[METRC] auth_denied", {
          companyId: this.companyId ?? null,
          path: pathLabel,
          auth_mode: authMode,
          status: res.status,
          message: message.slice(0, 500),
        });
        return {
          ok: false,
          status: res.status,
          message,
          durationMs,
          retries: transportRetries,
          rateLimitWaitedMs: totalRateWait,
          attemptedAuthModes: [authMode],
          endpoint: pathLabel,
        };
      }

      if (RETRYABLE_STATUSES.has(res.status) && transportRetries < MAX_TRANSPORT_RETRIES) {
        transportRetries += 1;
        const backoff = res.status === 429 ? 1000 * transportRetries : 500 * transportRetries;
        logWarn("[METRC] request_retry", {
          companyId: this.companyId ?? null,
          path: pathLabel,
          auth_mode: authMode,
          status: res.status,
          retry: transportRetries,
          backoffMs: backoff,
        });
        await sleep(backoff);
        continue;
      }

      return {
        ok: false,
        status: res.status,
        message,
        durationMs,
        retries: transportRetries,
        rateLimitWaitedMs: totalRateWait,
        attemptedAuthModes: [authMode],
        endpoint: pathLabel,
      };
    }

    return {
      ok: false,
      status: 502,
      message: "METRC request failed after retries.",
      durationMs: Math.max(0, Date.now() - t0),
      retries: transportRetries,
      rateLimitWaitedMs: totalRateWait,
      attemptedAuthModes: [authMode],
      endpoint: pathLabel,
    };
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
