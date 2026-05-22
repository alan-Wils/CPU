import type { MetrcEnvironment } from "./metrcResolveBaseUrl.js";

export type MetrcAuthCredentials = {
  environment: MetrcEnvironment;
  vendorApiKey: string;
  userApiKey: string;
  licenseNumber: string;
};

/** Auth mode labels stored in logs and UI (no secrets). */
export type MetrcClientAuthMode =
  | "vendor_only"
  | "sandbox_x_metrc_key"
  | "sandbox_x_metrc_key_and_user_key_header"
  | "sandbox_x_metrc_key_and_userkey_header"
  | "sandbox_x_metrc_key_and_x_user_key"
  | "sandbox_basic_license_user"
  | "sandbox_basic_vendor_user"
  | "sandbox_bearer_user"
  | "production_x_metrc_key"
  | "production_x_metrc_key_and_user_key"
  | "production_x_metrc_key_and_userkey";

const SANDBOX_OPERATIONAL_PLAN: MetrcClientAuthMode[] = [
  "sandbox_x_metrc_key",
  "sandbox_x_metrc_key_and_user_key_header",
  "sandbox_x_metrc_key_and_userkey_header",
  "sandbox_x_metrc_key_and_x_user_key",
  "sandbox_basic_license_user",
  "sandbox_basic_vendor_user",
];

const PRODUCTION_OPERATIONAL_PLAN: MetrcClientAuthMode[] = [
  "production_x_metrc_key",
  "production_x_metrc_key_and_user_key",
  "production_x_metrc_key_and_userkey",
];

const companyAuthModeCache = new Map<string, MetrcClientAuthMode>();

/** @internal test helper */
export function clearMetrcAuthStrategyCache(): void {
  companyAuthModeCache.clear();
}

export function cacheMetrcAuthModeForCompany(companyId: string, mode: MetrcClientAuthMode): void {
  companyAuthModeCache.set(companyId, mode);
}

export function getCachedMetrcAuthMode(companyId: string): MetrcClientAuthMode | null {
  return companyAuthModeCache.get(companyId) ?? null;
}

export function buildMetrcClientAuthPlan(input: {
  companyId?: string;
  vendorOnly: boolean;
  environment: MetrcEnvironment;
}): MetrcClientAuthMode[] {
  if (input.vendorOnly) return ["vendor_only"];

  const base =
    input.environment === "sandbox" ? [...SANDBOX_OPERATIONAL_PLAN] : [...PRODUCTION_OPERATIONAL_PLAN];

  if (!input.companyId) return base;
  const cached = companyAuthModeCache.get(input.companyId);
  if (cached && base.includes(cached)) {
    return [cached, ...base.filter((m) => m !== cached)];
  }
  return base;
}

export type MetrcAuthModeLog = {
  auth_mode: MetrcClientAuthMode;
  hasVendorKey: boolean;
  hasUserKey: boolean;
  licenseNumber: string | null;
  environment: MetrcEnvironment;
};

export function describeMetrcAuthMode(
  mode: MetrcClientAuthMode,
  creds: MetrcAuthCredentials,
): MetrcAuthModeLog {
  return {
    auth_mode: mode,
    hasVendorKey: Boolean(creds.vendorApiKey.trim()),
    hasUserKey: Boolean(creds.userApiKey.trim()),
    licenseNumber: creds.licenseNumber.trim() || null,
    environment: creds.environment,
  };
}

export type MetrcRequestAuth = {
  headers: Record<string, string>;
  /** Axios basic auth (never logged). */
  axiosBasic?: { username: string; password: string };
};

export function buildMetrcRequestAuth(
  creds: MetrcAuthCredentials,
  mode: MetrcClientAuthMode,
): MetrcRequestAuth | null {
  const vendor = creds.vendorApiKey.trim();
  const user = creds.userApiKey.trim();

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "CPU-NexBatch/1.0",
  };

  switch (mode) {
    case "vendor_only":
    case "sandbox_x_metrc_key":
    case "production_x_metrc_key":
      if (!vendor) return null;
      headers["x-metrc-key"] = vendor;
      return { headers };

    case "sandbox_x_metrc_key_and_user_key_header":
      if (!vendor || !user) return null;
      headers["x-metrc-key"] = vendor;
      headers["x-metrc-user-key"] = user;
      return { headers };

    case "sandbox_x_metrc_key_and_userkey_header":
      if (!vendor || !user) return null;
      headers["x-metrc-key"] = vendor;
      headers["x-metrc-userkey"] = user;
      return { headers };

    case "sandbox_x_metrc_key_and_x_user_key":
      if (!vendor || !user) return null;
      headers["x-metrc-key"] = vendor;
      headers["x-user-key"] = user;
      return { headers };

    case "sandbox_basic_license_user":
      if (!user || !creds.licenseNumber.trim()) return null;
      return {
        headers: vendor ? { ...headers, "x-metrc-key": vendor } : headers,
        axiosBasic: { username: creds.licenseNumber.trim(), password: user },
      };

    case "production_x_metrc_key_and_user_key":
      if (!vendor || !user) return null;
      headers["x-metrc-key"] = vendor;
      headers["x-metrc-user-key"] = user;
      return { headers };

    case "production_x_metrc_key_and_userkey":
      if (!vendor || !user) return null;
      headers["x-metrc-key"] = vendor;
      headers["x-metrc-userkey"] = user;
      return { headers };

    case "sandbox_basic_vendor_user":
      if (!vendor || !user) return null;
      return {
        headers: { ...headers, "x-metrc-key": vendor },
        axiosBasic: { username: vendor, password: user },
      };

    case "sandbox_bearer_user":
      if (!user) return null;
      if (vendor) headers["x-metrc-key"] = vendor;
      headers.Authorization = `Bearer ${user}`;
      return { headers };

    default:
      return null;
  }
}

/** Only HTTP 401 triggers the next auth mode (per sandbox operational spec). */
export function shouldTryNextMetrcAuthMode(status: number): boolean {
  return status === 401;
}

export function maskHeaderValue(name: string, value: string): string {
  const key = name.toLowerCase();
  if (
    key === "x-metrc-key"
    || key === "x-metrc-user-key"
    || key === "x-metrc-userkey"
    || key === "x-user-key"
    || key === "authorization"
  ) {
    const v = String(value || "").trim();
    if (!v) return "(empty)";
    if (v.length <= 8) return "****";
    return `${v.slice(0, 4)}…${v.slice(-4)} (${v.length} chars)`;
  }
  return value;
}

export function maskHeadersForLog(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = maskHeaderValue(k, v);
  }
  if (headers.Authorization?.startsWith("Basic ")) {
    out.Authorization = "Basic ****";
  }
  return out;
}
