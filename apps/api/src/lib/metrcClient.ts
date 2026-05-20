import axios, { type AxiosError, type AxiosRequestConfig } from "axios";
import { logInfo, logWarn } from "./logger.js";
import { resolveMetrcApiBaseUrl, type MetrcEnvironment } from "./metrcResolveBaseUrl.js";

const MIN_INTERVAL_MS = 200;
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 25_000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

let rateChain: Promise<void> = Promise.resolve();

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
};

export type MetrcClientFailure = {
  ok: false;
  status: number;
  message: string;
  durationMs: number;
  retries: number;
  rateLimitWaitedMs: number;
};

export type MetrcClientResult<T> = MetrcClientSuccess<T> | MetrcClientFailure;

export function isMetrcClientFailure<T>(r: MetrcClientResult<T>): r is MetrcClientFailure {
  return r.ok === false;
}

function buildBasicAuthorization(creds: MetrcClientCredentials): string | null {
  const userKey = creds.userApiKey.trim();
  if (!userKey) return null;
  const basicUser = creds.username.trim() || creds.licenseNumber.trim();
  const token = basicUser
    ? `${basicUser}:${userKey}`
    : `:${userKey}`;
  return `Basic ${Buffer.from(token, "utf8").toString("base64")}`;
}

function buildHeaders(creds: MetrcClientCredentials): Record<string, string> | null {
  const authorization = buildBasicAuthorization(creds);
  if (!authorization) return null;
  const headers: Record<string, string> = {
    Authorization: authorization,
    Accept: "application/json",
    "User-Agent": "CPU-NexBatch/1.0",
  };
  const vendor = creds.vendorApiKey.trim();
  if (vendor) headers["x-metrc-key"] = vendor;
  return headers;
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

export class MetrcClient {
  readonly baseUrl: string | null;
  private readonly headers: Record<string, string> | null;

  constructor(
    private readonly creds: MetrcClientCredentials,
    private readonly companyId?: string,
  ) {
    this.baseUrl = resolveMetrcApiBaseUrl({
      stateCode: creds.stateCode,
      environment: creds.environment,
      apiBaseUrlOverride: creds.apiBaseUrlOverride,
    });
    this.headers = buildHeaders(creds);
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
    /** Absolute URL override (e.g. sandbox integrator setup on CO host). */
    absoluteUrl?: string;
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
      };
    }

    if (!this.headers && !input.absoluteUrl) {
      return {
        ok: false,
        status: 400,
        message: "User API key is required for METRC requests.",
        durationMs: 0,
        retries: 0,
        rateLimitWaitedMs: 0,
      };
    }

    const headers = input.absoluteUrl
      ? {
          Accept: "application/json",
          "User-Agent": "CPU-NexBatch/1.0",
          ...(this.creds.vendorApiKey.trim()
            ? { "x-metrc-key": this.creds.vendorApiKey.trim() }
            : {}),
        }
      : (this.headers as Record<string, string>);

    let retries = 0;
    let totalRateWait = 0;
    const pathLabel = path.split("?")[0] || input.absoluteUrl?.split("/").slice(-3).join("/");
    const t0 = Date.now();

    while (true) {
      const rateLimitWaitedMs = await acquireRateSlot(this.companyId);
      totalRateWait += rateLimitWaitedMs;

      const config: AxiosRequestConfig = {
        method: input.method,
        url,
        headers,
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: () => true,
      };
      if (input.body !== undefined && input.method !== "GET") {
        config.data = input.body;
        config.headers = { ...headers, "Content-Type": "application/json" };
      }

      logInfo("[METRC] request_start", {
        companyId: this.companyId ?? null,
        method: input.method,
        path: pathLabel,
        attempt: retries + 1,
      });

      let resStatus = 0;
      try {
        const res = await axios.request<T>(config);
        resStatus = res.status;
        const durationMs = Math.max(0, Date.now() - t0);

        logInfo("[METRC] request_complete", {
          companyId: this.companyId ?? null,
          method: input.method,
          path: pathLabel,
          status: res.status,
          durationMs,
          retries,
          rateLimitWaitedMs: totalRateWait,
        });

        if (res.status >= 200 && res.status < 300) {
          return {
            ok: true,
            status: res.status,
            data: res.data,
            durationMs,
            retries,
            rateLimitWaitedMs: totalRateWait,
          };
        }

        if (RETRYABLE_STATUSES.has(res.status) && retries < MAX_RETRIES) {
          retries += 1;
          const backoff = res.status === 429 ? 1000 * retries : 500 * retries;
          logWarn("[METRC] request_retry", {
            companyId: this.companyId ?? null,
            path: pathLabel,
            status: res.status,
            retry: retries,
            backoffMs: backoff,
          });
          await sleep(backoff);
          continue;
        }

        const message =
          typeof res.data === "string"
            ? res.data.slice(0, 2000)
            : JSON.stringify(res.data ?? {}).slice(0, 2000) || `METRC returned HTTP ${res.status}.`;

        return {
          ok: false,
          status: res.status,
          message,
          durationMs,
          retries,
          rateLimitWaitedMs: totalRateWait,
        };
      } catch (error) {
        const ax = axios.isAxiosError(error) ? error : null;
        const durationMs = Math.max(0, Date.now() - t0);
        const { status, message } = ax
          ? summarizeAxiosError(ax)
          : { status: 0, message: error instanceof Error ? error.message : "METRC request failed." };

        const retryable =
          (ax && (RETRYABLE_STATUSES.has(status) || ax.code === "ECONNABORTED")) && retries < MAX_RETRIES;

        logWarn("[METRC] request_error", {
          companyId: this.companyId ?? null,
          path: pathLabel,
          status: status || resStatus,
          durationMs,
          retries,
          retryable,
          message: message.slice(0, 500),
        });

        if (retryable) {
          retries += 1;
          let backoff = status === 429 ? 1000 * retries : 500 * retries;
          if (ax) {
            const retryAfter = resolveRetryAfterMs(ax);
            if (retryAfter != null) backoff = retryAfter;
          }
          logWarn("[METRC] request_retry", {
            companyId: this.companyId ?? null,
            path: pathLabel,
            status,
            retry: retries,
            backoffMs: backoff,
          });
          await sleep(backoff);
          continue;
        }

        return {
          ok: false,
          status,
          message,
          durationMs,
          retries,
          rateLimitWaitedMs: totalRateWait,
        };
      }
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
