import axios, { type AxiosError, type AxiosRequestConfig } from "axios";
import { env } from "../config/env.js";
import {
  buildMetrcClientAuthPlan,
  buildMetrcRequestAuth,
  cacheMetrcAuthModeForCompany,
  clearMetrcAuthStrategyCache,
  describeMetrcAuthMode,
  listMetrcAuthHeaderNames,
  maskHeadersForLog,
  shouldTryNextMetrcAuthMode,
  type MetrcAuthModeLog,
  type MetrcClientAuthMode,
} from "./metrcAuthStrategy.js";

export { shouldTryNextMetrcAuthMode } from "./metrcAuthStrategy.js";
import { logInfo, logWarn } from "./logger.js";
import { formatMetrcKeyFingerprint } from "./metrcKeyFingerprint.js";
import { resolveMetrcApiBaseUrl, type MetrcEnvironment } from "./metrcResolveBaseUrl.js";

export type { MetrcAuthModeLog, MetrcClientAuthMode };
export {
  buildMetrcClientAuthPlan,
  cacheMetrcAuthModeForCompany,
  describeMetrcAuthMode,
  getCachedMetrcAuthMode,
} from "./metrcAuthStrategy.js";

const MIN_INTERVAL_MS = 200;
const MAX_TRANSPORT_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 25_000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

let rateChain: Promise<void> = Promise.resolve();

/** @internal test helper */
export function clearMetrcClientAuthCache(): void {
  clearMetrcAuthStrategyCache();
}

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
  metrcMessage: string;
};

export type MetrcUpstreamError = {
  upstream: "metrc";
  type: "html_runtime_error";
  endpoint: string;
  status: number;
};

export const METRC_HTML_RUNTIME_USER_MESSAGE =
  "METRC sandbox returned a server/runtime error for this endpoint.";

export type MetrcAuthAttemptRecord = {
  mode: MetrcClientAuthMode;
  status: number;
  durationMs: number;
  metrcMessage: string;
};

export type MetrcClientFailure = {
  ok: false;
  status: number;
  message: string;
  durationMs: number;
  retries: number;
  rateLimitWaitedMs: number;
  attemptedAuthModes: MetrcClientAuthMode[];
  authAttempts: MetrcAuthAttemptRecord[];
  endpoint?: string;
  upstreamError?: MetrcUpstreamError;
  metrcMessage: string;
};

function pickAuthFailureSummary(attempts: MetrcAuthAttemptRecord[]): {
  status: number;
  message: string;
} {
  const denied = attempts.filter((a) => a.status === 401 || a.status === 403);
  const lastDenied = denied[denied.length - 1];
  if (lastDenied) {
    return { status: lastDenied.status, message: lastDenied.metrcMessage };
  }
  const last = attempts[attempts.length - 1];
  if (last) return { status: last.status, message: last.metrcMessage };
  return { status: 401, message: "METRC authorization failed." };
}

export type MetrcClientResult<T> = MetrcClientSuccess<T> | MetrcClientFailure;

export function isMetrcClientFailure<T>(r: MetrcClientResult<T>): r is MetrcClientFailure {
  return r.ok === false;
}

function logMetrcAuthMode(
  companyId: string | undefined,
  mode: MetrcClientAuthMode,
  creds: MetrcClientCredentials,
  event: string,
): void {
  const ctx = describeMetrcAuthMode(mode, creds);
  logInfo(event, {
    companyId: companyId ?? null,
    auth_mode: ctx.auth_mode,
    hasVendorKey: ctx.hasVendorKey,
    hasUserKey: ctx.hasUserKey,
    licenseNumber: ctx.licenseNumber,
    environment: ctx.environment,
  });
}

function logMetrcKeyDispatchDiagnostics(input: {
  companyId?: string;
  authMode: MetrcClientAuthMode;
  creds: MetrcClientCredentials;
  headers: Record<string, string>;
  axiosBasic?: { username: string; password: string };
}): void {
  logInfo("[METRC] key_dispatch", {
    companyId: input.companyId ?? null,
    auth_mode: input.authMode,
    vendorKeyLoaded: formatMetrcKeyFingerprint(input.creds.vendorApiKey),
    userKeyLoaded: formatMetrcKeyFingerprint(input.creds.userApiKey),
    authHeaderNames: listMetrcAuthHeaderNames(input.authMode),
    usesBasicAuth: Boolean(input.axiosBasic),
    basicUsernameFingerprint: input.axiosBasic
      ? formatMetrcKeyFingerprint(input.axiosBasic.username)
      : "(none)",
    basicPasswordFingerprint: input.axiosBasic
      ? formatMetrcKeyFingerprint(input.axiosBasic.password)
      : "(none)",
    outgoingXMetrcKey: formatMetrcKeyFingerprint(input.headers["x-metrc-key"] ?? ""),
  });
}

function logMetrcSandboxVerbose(parts: {
  companyId?: string;
  event: string;
  url: string;
  method: string;
  authMode: MetrcClientAuthMode;
  headers: Record<string, string>;
  status: number;
  metrcMessage: string;
  responseBody: unknown;
  provisioningState?: string | null;
  userCreationPending?: boolean;
}): void {
  logInfo(parts.event, {
    companyId: parts.companyId ?? null,
    requestUrl: parts.url,
    method: parts.method,
    auth_mode: parts.authMode,
    headers: maskHeadersForLog(parts.headers),
    status: parts.status,
    metrcMessage: parts.metrcMessage.slice(0, 2000),
    responseBody: formatBodyForDevLog(parts.responseBody),
    provisioningState: parts.provisioningState ?? null,
    userCreationPending: parts.userCreationPending ?? null,
  });
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

export function summarizeMetrcResponseMessage(status: number, data: unknown): string {
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (looksLikeHtmlBody(trimmed)) return METRC_HTML_RUNTIME_USER_MESSAGE;
    if (trimmed) return trimmed.slice(0, 2000);
  }
  if (Array.isArray(data) && data.length) {
    const first = data[0] as { message?: string; Message?: string };
    const msg = first?.message ?? first?.Message;
    if (msg) return String(msg).slice(0, 2000);
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
  return {
    status,
    message: summarizeMetrcResponseMessage(status, data),
  };
}

async function axiosOnce<T>(config: AxiosRequestConfig): Promise<{
  res: { status: number; data: T; contentType: string | null };
  transportError: { status: number; message: string } | null;
}> {
  const safeConfig: AxiosRequestConfig = { ...config };
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

function buildMetrcHtmlRuntimeFailure(input: {
  pathLabel: string;
  status: number;
  contentType: string | null;
  data: unknown;
  durationMs: number;
  retries: number;
  rateLimitWaitedMs: number;
  attemptedAuthModes: MetrcClientAuthMode[];
  authAttempts?: MetrcAuthAttemptRecord[];
  companyId?: string;
}): MetrcClientFailure {
  const metrcMessage = METRC_HTML_RUNTIME_USER_MESSAGE;
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
    message: metrcMessage,
    metrcMessage,
    durationMs: input.durationMs,
    retries: input.retries,
    rateLimitWaitedMs: input.rateLimitWaitedMs,
    attemptedAuthModes: input.attemptedAuthModes,
    authAttempts: input.authAttempts ?? [],
    endpoint: input.pathLabel,
    upstreamError: {
      upstream: "metrc",
      type: "html_runtime_error",
      endpoint: input.pathLabel,
      status: input.status || 502,
    },
  };
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
        metrcMessage: "",
        durationMs: 0,
        retries: 0,
        rateLimitWaitedMs: 0,
        attemptedAuthModes: [],
        authAttempts: [],
      };
    }

    const pathLabel =
      path.split("?")[0]
      || input.absoluteUrl?.split("/").slice(-3).join("/")
      || path;
    const t0 = Date.now();
    const vendorOnly = Boolean(input.absoluteUrl || input.vendorOnly);

    if (!this.creds.vendorApiKey.trim()) {
      return {
        ok: false,
        status: 400,
        message: "Vendor API key is required for METRC Connect requests.",
        metrcMessage: "",
        durationMs: 0,
        retries: 0,
        rateLimitWaitedMs: 0,
        attemptedAuthModes: [],
        authAttempts: [],
      };
    }

    const authPlan = buildMetrcClientAuthPlan({
      companyId: this.companyId,
      vendorOnly,
      environment: this.creds.environment,
    });
    const attemptedAuthModes: MetrcClientAuthMode[] = [];
    const authAttempts: MetrcAuthAttemptRecord[] = [];
    let lastStatus = 0;
    let lastMessage = "METRC authorization failed.";
    let transportRetries = 0;
    let totalRateWait = 0;
    const isSandbox = this.creds.environment === "sandbox";
    const rotateAuthModes = !vendorOnly && authPlan.length > 1;

    for (const mode of authPlan) {
      const modeStartedAt = Date.now();
      const auth = buildMetrcRequestAuth(this.creds, mode);
      if (!auth) continue;

      attemptedAuthModes.push(mode);

      logMetrcAuthMode(this.companyId, mode, this.creds, "[METRC] auth_strategy_attempt");
      logMetrcAuthMode(this.companyId, mode, this.creds, "[METRC] auth_mode");

      let modeTransportRetries = 0;

      while (modeTransportRetries <= MAX_TRANSPORT_RETRIES) {
        const rateLimitWaitedMs = await acquireRateSlot(this.companyId);
        totalRateWait += rateLimitWaitedMs;

        const config: AxiosRequestConfig = {
          method: input.method,
          url,
          headers: auth.headers,
          timeout: REQUEST_TIMEOUT_MS,
          validateStatus: () => true,
          auth: auth.axiosBasic ?? undefined,
        };
        if (input.body !== undefined && input.method !== "GET") {
          config.data = input.body;
        }

        logInfo("[METRC] request_start", {
          companyId: this.companyId ?? null,
          method: input.method,
          path: pathLabel,
          requestUrl: url,
          auth_mode: mode,
          attempt: modeTransportRetries + 1,
          environment: this.creds.environment,
        });

        if (!vendorOnly) {
          logMetrcKeyDispatchDiagnostics({
            companyId: this.companyId,
            authMode: mode,
            creds: this.creds,
            headers: auth.headers,
            axiosBasic: auth.axiosBasic,
          });
        }

        if (isSandbox || vendorOnly) {
          logMetrcSandboxVerbose({
            companyId: this.companyId,
            event: vendorOnly ? "[METRC] sandbox_provision_request" : "[METRC] sandbox_operational_request",
            url,
            method: input.method,
            authMode: mode,
            headers: auth.headers,
            status: 0,
            metrcMessage: "",
            responseBody: null,
            userCreationPending: !this.creds.userApiKey.trim() && !vendorOnly,
          });
        }

        const { res, transportError } = await axiosOnce<T>(config);
        const durationMs = Math.max(0, Date.now() - t0);
        const metrcMessage = summarizeMetrcResponseMessage(
          transportError?.status ?? res.status,
          res.data,
        );

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
            metrcMessage: transportError.message,
            durationMs,
            retries: transportRetries,
            rateLimitWaitedMs: totalRateWait,
            attemptedAuthModes,
            authAttempts,
            endpoint: pathLabel,
          };
        }

        logInfo("[METRC] request_complete", {
          companyId: this.companyId ?? null,
          method: input.method,
          path: pathLabel,
          requestUrl: url,
          status: res.status,
          auth_mode: mode,
          durationMs,
          transportRetries: modeTransportRetries,
          rateLimitWaitedMs: totalRateWait,
          metrcMessage: metrcMessage.slice(0, 200),
          environment: this.creds.environment,
        });

        if (isSandbox || vendorOnly) {
          logMetrcSandboxVerbose({
            companyId: this.companyId,
            event: vendorOnly
              ? "[METRC] sandbox_provision_response"
              : "[METRC] sandbox_operational_response",
            url,
            method: input.method,
            authMode: mode,
            headers: auth.headers,
            status: transportError?.status ?? res.status,
            metrcMessage,
            responseBody: res.data,
            userCreationPending: !this.creds.userApiKey.trim() && !vendorOnly,
          });
        }

        const modeDurationMs = Math.max(0, Date.now() - modeStartedAt);

        if (detectMetrcHtmlResponse(res.contentType, res.data)) {
          const htmlMessage = METRC_HTML_RUNTIME_USER_MESSAGE;
          authAttempts.push({
            mode,
            status: res.status || 502,
            durationMs: modeDurationMs,
            metrcMessage: htmlMessage,
          });
          lastStatus = res.status || 502;
          lastMessage = htmlMessage;
          if (rotateAuthModes) {
            logWarn("[METRC] auth_strategy_html_skip", {
              companyId: this.companyId ?? null,
              path: pathLabel,
              auth_mode: mode,
              status: res.status,
            });
            break;
          }
          return buildMetrcHtmlRuntimeFailure({
            pathLabel,
            status: res.status,
            contentType: res.contentType,
            data: res.data,
            durationMs,
            retries: transportRetries,
            rateLimitWaitedMs: totalRateWait,
            attemptedAuthModes,
            authAttempts,
            companyId: this.companyId,
          });
        }

        if (res.status >= 200 && res.status < 300) {
          if (this.companyId) cacheMetrcAuthModeForCompany(this.companyId, mode);
          logMetrcAuthMode(this.companyId, mode, this.creds, "[METRC] auth_strategy_success");
          return {
            ok: true,
            status: res.status,
            data: res.data,
            durationMs,
            retries: transportRetries,
            rateLimitWaitedMs: totalRateWait,
            authMode: mode,
            metrcMessage,
          };
        }

        lastStatus = res.status;
        lastMessage = metrcMessage;
        authAttempts.push({
          mode,
          status: res.status,
          durationMs: modeDurationMs,
          metrcMessage,
        });

        if (shouldTryNextMetrcAuthMode(res.status)) {
          logWarn("[METRC] auth_strategy_denied", {
            companyId: this.companyId ?? null,
            path: pathLabel,
            auth_mode: mode,
            status: res.status,
            metrcMessage: metrcMessage.slice(0, 500),
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

        const summary = pickAuthFailureSummary(authAttempts);
        return {
          ok: false,
          status: summary.status,
          message: summary.message,
          metrcMessage: summary.message,
          durationMs,
          retries: transportRetries,
          rateLimitWaitedMs: totalRateWait,
          attemptedAuthModes,
          authAttempts,
          endpoint: pathLabel,
        };
      }
    }

    const summary = pickAuthFailureSummary(authAttempts);

    logWarn("[METRC] auth_strategy_failed_all_modes", {
      companyId: this.companyId ?? null,
      path: pathLabel,
      attemptedAuthModes,
      lastStatus: summary.status,
      metrcMessage: summary.message.slice(0, 500),
    });

    return {
      ok: false,
      status: summary.status || lastStatus || 401,
      message: summary.message || lastMessage,
      metrcMessage: summary.message || lastMessage,
      durationMs: Math.max(0, Date.now() - t0),
      retries: transportRetries,
      rateLimitWaitedMs: totalRateWait,
      attemptedAuthModes,
      authAttempts,
      endpoint: pathLabel,
    };
  }

  get<T = unknown>(pathnameAndQuery: string): Promise<MetrcClientResult<T>> {
    return this.request<T>({ method: "GET", pathnameAndQuery });
  }

  /** Run one auth mode only (for debug-auth diagnostics). */
  async probeAuthMode<T = unknown>(
    pathnameAndQuery: string,
    mode: MetrcClientAuthMode,
  ): Promise<{
    authMode: MetrcClientAuthMode;
    status: number;
    metrcMessage: string;
    maskedHeaders: Record<string, string>;
    usedBasicAuth: boolean;
    data: T | undefined;
  }> {
    const path = String(pathnameAndQuery || "").trim();
    const url =
      this.baseUrl && path.startsWith("/")
        ? `${this.baseUrl.replace(/\/+$/, "")}${path}`
        : null;
    if (!url) {
      return {
        authMode: mode,
        status: 400,
        metrcMessage: "METRC base URL is not configured.",
        maskedHeaders: {},
        usedBasicAuth: false,
        data: undefined,
      };
    }

    const auth = buildMetrcRequestAuth(this.creds, mode);
    if (!auth) {
      return {
        authMode: mode,
        status: 400,
        metrcMessage: "Auth mode skipped — missing vendor or user key for this strategy.",
        maskedHeaders: {},
        usedBasicAuth: false,
        data: undefined,
      };
    }

    await acquireRateSlot(this.companyId);
    const config: AxiosRequestConfig = {
      method: "GET",
      url,
      headers: auth.headers,
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
      auth: auth.axiosBasic ?? undefined,
    };
    const { res, transportError } = await axiosOnce<T>(config);
    const status = transportError?.status ?? res.status;
    const metrcMessage = summarizeMetrcResponseMessage(status, res.data);
    return {
      authMode: mode,
      status,
      metrcMessage,
      maskedHeaders: maskHeadersForLog(auth.headers),
      usedBasicAuth: Boolean(auth.axiosBasic),
      data: res.data,
    };
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
