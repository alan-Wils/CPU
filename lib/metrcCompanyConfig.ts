/**
 * METRC credentials and endpoint settings stored under `company.metrc` in Company Config.
 * Used by the API layer on Railway — keys never belong in frontend env vars per tenant.
 */

export type MetrcEnvironment = "production" | "sandbox";

export type MetrcLastConnectionStatus = "connected" | "not_connected";

export type MetrcCompanyConfig = {
  /** Software vendor / integrator API key from METRC (optional; dual-key auth when set with user key). */
  apiKey: string;
  /** User API key (facility operator key from METRC) */
  userKey: string;
  /** Facility license number (often required in URL paths) */
  licenseNumber: string;
  facilityName: string;
  /** Operator notes; not sent to METRC */
  notes: string;
  /** Two-letter state code for default API host (e.g. CO, CA) */
  stateCode: string;
  environment: MetrcEnvironment;
  /**
   * Optional full API root override (no trailing slash), e.g. https://api-co.metrc.com
   * When set, overrides state/environment-derived URL.
   */
  apiBaseUrlOverride: string;
  /** When true, server may perform METRC calls for this company */
  integrationEnabled: boolean;
  /** Last METRC connection test outcome (server-persisted; never includes secrets). */
  metrcLastConnectionStatus?: MetrcLastConnectionStatus | "";
  metrcLastConnectionCheckedAt?: string;
  metrcLastConnectionMessage?: string;
  /** HTTP status from the last METRC call when `not_connected` (0 = transport / timeout). */
  metrcLastConnectionHttpStatus?: number | null;
  metrcLastLocationCount?: number | null;
  /** Last successful GET /locations/v2/active auth mode label (server-set). */
  metrcLastSuccessfulAuthMode?: string | null;
  /** Present when API scrubbed secrets; key still stored server-side. */
  hasMetrcVendorApiKey?: boolean;
  hasMetrcUserApiKey?: boolean;
};

export const defaultMetrcCompanyConfig: MetrcCompanyConfig = {
  apiKey: "",
  userKey: "",
  licenseNumber: "",
  facilityName: "",
  notes: "",
  stateCode: "",
  environment: "production",
  apiBaseUrlOverride: "",
  integrationEnabled: false,
};

/**
 * Resolves REST API base URL for METRC-style hosts.
 * Pattern follows common state subdomains; use `apiBaseUrlOverride` if your state differs.
 */
export function resolveMetrcApiBaseUrl(m: Partial<MetrcCompanyConfig>): string | null {
  const override = String(m.apiBaseUrlOverride || "").trim().replace(/\/+$/, "");
  if (override) return override;

  const state = String(m.stateCode || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) return null;

  const st = state.toLowerCase();
  const sandbox = m.environment === "sandbox";

  // Typical METRC regional API hosts — confirm against your state's integration guide.
  if (sandbox) {
    return `https://sandbox-api-${st}.metrc.com`;
  }
  return `https://api-${st}.metrc.com`;
}
