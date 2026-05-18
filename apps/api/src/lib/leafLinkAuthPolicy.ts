import { AppError } from "../errors/AppError.js";
import { logInfo } from "./logger.js";

export function leafLinkAuthMode(authValue: string): "App" | "Token" | "Bearer" | "Basic" {
  if (authValue.startsWith("App ")) return "App";
  if (authValue.startsWith("Token ")) return "Token";
  if (authValue.startsWith("Bearer ")) return "Bearer";
  return "Basic";
}

/** Suppress re-trying auth modes that recently failed for this tenant + endpoint signature. */
const AUTH_COMBO_COOLDOWN_MS = 20 * 60_000;

const authComboCooldownUntil = new Map<string, number>();
/** Preferred Authorization header value per tenant + endpoint signature. */
const preferredAuthByTenantEndpoint = new Map<string, string>();
/** Dedupe noisy auth-failure logs within cooldown. */
const authFailureLoggedUntil = new Map<string, number>();

export type LeafLinkAuthFailureCode =
  | "LEAFLINK_INVALID_CREDENTIALS"
  | "LEAFLINK_INVALID_TOKEN"
  | "LEAFLINK_AUTH_MODE_DENIED"
  | "LEAFLINK_FORBIDDEN_ENDPOINT"
  | "LEAFLINK_COMPANY_SCOPE_DENIED"
  | "LEAFLINK_TEMPORARY_403"
  | "LEAFLINK_TEMPORARY";

export type ClassifiedLeafLinkAuthError = {
  code: LeafLinkAuthFailureCode;
  message: string;
  httpStatus: number;
};

export type LeafLinkFetchAuthContext = {
  tenantKey: string;
  authMode: string;
  endpoint: string;
};

function cleanString(v: unknown): string {
  return String(v ?? "").trim();
}

export function leafLinkTenantKey(creds: {
  baseUrl: string;
  companyId?: string;
  companySlug?: string;
}): string {
  return `${cleanString(creds.baseUrl)}|${cleanString(creds.companyId || creds.companySlug || "global")}`;
}

/** Stable path signature (strip query + numeric ids) for cooldown keys. */
export function leafLinkEndpointSignature(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/[0-9a-f-]{8,}/gi, "/:id/");
    return `${u.host}${path}`;
  } catch {
    return url.slice(0, 160);
  }
}

function authComboKey(tenantKey: string, endpointSig: string, authMode: string): string {
  return `${tenantKey}|${endpointSig}|${authMode}`;
}

function preferredAuthKey(tenantKey: string, endpointSig: string): string {
  return `${tenantKey}|${endpointSig}`;
}

export function isLeafLinkAuthComboInCooldown(
  tenantKey: string,
  endpoint: string,
  authMode: string,
): boolean {
  const until = authComboCooldownUntil.get(authComboKey(tenantKey, leafLinkEndpointSignature(endpoint), authMode));
  return until != null && until > Date.now();
}

export function markLeafLinkAuthComboFailed(
  tenantKey: string,
  endpoint: string,
  authMode: string,
  code: string,
): void {
  if (!isLeafLinkAuthFallbackCode(code)) return;
  const key = authComboKey(tenantKey, leafLinkEndpointSignature(endpoint), authMode);
  authComboCooldownUntil.set(key, Date.now() + AUTH_COMBO_COOLDOWN_MS);
}

export function markLeafLinkAuthComboSucceeded(
  tenantKey: string,
  endpoint: string,
  authValue: string,
  authMode: string,
): void {
  const sig = leafLinkEndpointSignature(endpoint);
  preferredAuthByTenantEndpoint.set(preferredAuthKey(tenantKey, sig), authValue);
  const comboKey = authComboKey(tenantKey, sig, authMode);
  authComboCooldownUntil.delete(comboKey);
}

export function orderedLeafLinkAuthCandidates(
  allCandidates: string[],
  tenantKey: string,
  endpoint: string,
): string[] {
  const all = allCandidates;
  const sig = leafLinkEndpointSignature(endpoint);
  const preferred = preferredAuthByTenantEndpoint.get(preferredAuthKey(tenantKey, sig));
  const active = all.filter((authValue) => {
    const mode = leafLinkAuthMode(authValue);
    return !isLeafLinkAuthComboInCooldown(tenantKey, endpoint, mode);
  });
  const pool = active.length > 0 ? active : all;
  if (!preferred || !pool.includes(preferred)) return pool;
  return [preferred, ...pool.filter((v) => v !== preferred)];
}

function bodyDetailLower(parsed: unknown): string {
  if (parsed == null) return "";
  if (typeof parsed === "string") return parsed.toLowerCase();
  if (typeof parsed !== "object" || Array.isArray(parsed)) return "";
  const o = parsed as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of ["detail", "message", "error", "non_field_errors"]) {
    const v = o[k];
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) parts.push(v.map(String).join(" "));
  }
  return parts.join(" ").toLowerCase();
}

export function classifyLeafLinkAuthHttpError(
  status: number,
  parsedBody: unknown,
  endpoint: string,
): ClassifiedLeafLinkAuthError {
  const detail = bodyDetailLower(parsedBody);
  const endpointLower = endpoint.toLowerCase();

  if (status === 429) {
    return {
      code: "LEAFLINK_TEMPORARY_403",
      message: "LeafLink rate-limited or temporarily denied this request.",
      httpStatus: 429,
    };
  }

  if (status === 401) {
    if (
      detail.includes("token") ||
      detail.includes("expired") ||
      detail.includes("authentication") ||
      detail.includes("credentials")
    ) {
      return {
        code: detail.includes("expired") ? "LEAFLINK_INVALID_TOKEN" : "LEAFLINK_INVALID_CREDENTIALS",
        message: "LeafLink rejected the API token or credentials (401).",
        httpStatus: 401,
      };
    }
    return {
      code: "LEAFLINK_AUTH_MODE_DENIED",
      message: "LeafLink rejected this authorization mode (401).",
      httpStatus: 401,
    };
  }

  if (status === 403) {
    if (
      detail.includes("rate") ||
      detail.includes("throttl") ||
      detail.includes("too many") ||
      detail.includes("temporarily")
    ) {
      return {
        code: "LEAFLINK_TEMPORARY_403",
        message: "LeafLink temporarily denied access (403).",
        httpStatus: 403,
      };
    }
    if (
      detail.includes("company") ||
      detail.includes("seller") ||
      detail.includes("scope") ||
      endpointLower.includes("/companies/")
    ) {
      return {
        code: "LEAFLINK_COMPANY_SCOPE_DENIED",
        message: "LeafLink denied access for this company scope or seller (403).",
        httpStatus: 403,
      };
    }
    if (detail.includes("permission") || detail.includes("forbidden") || detail.includes("not allowed")) {
      return {
        code: "LEAFLINK_FORBIDDEN_ENDPOINT",
        message: "LeafLink forbids this endpoint for the current token (403).",
        httpStatus: 403,
      };
    }
    return {
      code: "LEAFLINK_AUTH_MODE_DENIED",
      message: "LeafLink denied this request with 403 (auth mode or endpoint may be wrong).",
      httpStatus: 403,
    };
  }

  return {
    code: "LEAFLINK_AUTH_MODE_DENIED",
    message: `LeafLink authorization failed (${status}).`,
    httpStatus: status,
  };
}

export function isLeafLinkAuthFallbackCode(code: string): boolean {
  return (
    code === "LEAFLINK_INVALID_CREDENTIALS"
    || code === "LEAFLINK_INVALID_TOKEN"
    || code === "LEAFLINK_AUTH_MODE_DENIED"
    || code === "LEAFLINK_FORBIDDEN_ENDPOINT"
    || code === "LEAFLINK_COMPANY_SCOPE_DENIED"
    || code === "LEAFLINK_TEMPORARY_403"
    || code === "LEAFLINK_REQUEST_FAILED"
    || code === "LEAFLINK_HTML_ERROR"
    || code === "LEAFLINK_NON_JSON_RESPONSE"
    || code === "LEAFLINK_TEMPORARY"
  );
}

export function logLeafLinkAuthFailure(parts: {
  tenantKey: string;
  authMode: string;
  endpoint: string;
  reasonCode: string;
  httpStatus?: number;
  fallbackUsed?: boolean;
  fallbackSucceeded?: boolean;
  retrySuppressed?: boolean;
  cooldownActive?: boolean;
}): void {
  const sig = leafLinkEndpointSignature(parts.endpoint);
  const logKey = `${parts.tenantKey}|${sig}|${parts.authMode}|${parts.reasonCode}`;
  const prev = authFailureLoggedUntil.get(logKey);
  if (prev != null && prev > Date.now()) return;
  authFailureLoggedUntil.set(logKey, Date.now() + AUTH_COMBO_COOLDOWN_MS);

  logInfo("[LEAFLINK] auth_attempt_denied", {
    reasonCode: parts.reasonCode,
    httpStatus: parts.httpStatus,
    authMode: parts.authMode,
    endpoint: parts.endpoint.slice(0, 220),
    fallbackUsed: Boolean(parts.fallbackUsed),
    fallbackSucceeded: Boolean(parts.fallbackSucceeded),
    retrySuppressed: Boolean(parts.retrySuppressed),
    cooldownActive: Boolean(parts.cooldownActive),
  });
}

export function logLeafLinkAuthFallback(parts: {
  tenantKey: string;
  authMode: string;
  endpoint: string;
  reasonCode: string;
  fallbackUsed: boolean;
}): void {
  logInfo("[LEAFLINK] auth_fallback_attempt", {
    reasonCode: parts.reasonCode,
    authMode: parts.authMode,
    endpoint: parts.endpoint.slice(0, 220),
    fallbackUsed: parts.fallbackUsed,
    cooldownActive: isLeafLinkAuthComboInCooldown(parts.tenantKey, parts.endpoint, parts.authMode),
  });
}

export function throwClassifiedLeafLinkAuthError(
  status: number,
  parsedBody: unknown,
  ctx: LeafLinkFetchAuthContext,
  opts?: { fallbackUsed?: boolean },
): never {
  const classified = classifyLeafLinkAuthHttpError(status, parsedBody, ctx.endpoint);
  markLeafLinkAuthComboFailed(ctx.tenantKey, ctx.endpoint, ctx.authMode, classified.code);
  logLeafLinkAuthFailure({
    tenantKey: ctx.tenantKey,
    authMode: ctx.authMode,
    endpoint: ctx.endpoint,
    reasonCode: classified.code,
    httpStatus: status,
    fallbackUsed: opts?.fallbackUsed,
    retrySuppressed: true,
    cooldownActive: true,
  });
  throw new AppError(classified.message, classified.httpStatus, classified.code);
}

/** @internal tests */
export function _resetLeafLinkAuthPolicyForTests(): void {
  authComboCooldownUntil.clear();
  preferredAuthByTenantEndpoint.clear();
  authFailureLoggedUntil.clear();
}
