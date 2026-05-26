/**
 * METRC credentials and endpoint settings stored under `company.metrc` in Company Config.
 * Used by the API layer on Railway — keys never belong in frontend env vars per tenant.
 */

export type MetrcEnvironment = "production" | "sandbox";

export type MetrcLastConnectionStatus = "connected" | "not_connected";

export type MetrcCompanyConfig = {
  /** Software vendor / integrator API key from METRC (optional; dual-key auth when set with user key). */
  apiKey: string;
  /** Alias for `apiKey` in some METRC sandbox docs; stored as `apiKey` in DB. */
  vendorApiKey?: string;
  /** User API key (facility operator key from METRC) */
  userKey: string;
  /** Alias persisted alongside `userKey` (sandbox setup / some METRC docs). */
  userApiKey?: string;
  /** METRC account username (from sandbox integrator setup; used for Basic auth). */
  username: string;
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
  /** Server-reported stored key length (never the key itself). */
  metrcUserKeyLength?: number | null;
  metrcVendorKeyLength?: number | null;
  /** Last sandbox/resource pull timestamps (ISO); no secrets. */
  metrcSandboxLastFacilitiesSyncAt?: string;
  metrcSandboxLastStrainsSyncAt?: string;
  metrcSandboxLastItemsSyncAt?: string;
  metrcSandboxLastRoomsSyncAt?: string;
  /** ISO timestamp of last GET /locations/v2/active sync. */
  metrcLastLocationsSyncAt?: string;
  /** Alias for integrations UI — same as metrcLastLocationsSyncAt. */
  lastLocationsSync?: string;
  /** Count from last locations sync. */
  metrcTotalLocationsSynced?: number | null;
  /** Alias for integrations UI — same as metrcTotalLocationsSynced. */
  totalLocationsSynced?: number | null;
  metrcSandboxLastPackagesSyncAt?: string;
  metrcSandboxLastFacilitiesCount?: number | null;
  metrcSandboxLastStrainsCount?: number | null;
  metrcSandboxLastItemsCount?: number | null;
  metrcSandboxLastRoomsCount?: number | null;
  metrcSandboxLastPackagesCount?: number | null;
  /** Non-secret warning from last METRC client rate-limit / retry behavior. */
  metrcSandboxLastRateLimitWarning?: string;
  /** METRC is asynchronously creating the sandbox facility user. */
  sandboxProvisioning?: boolean;
  sandboxProvisioningStartedAt?: string;
  sandboxProvisioningLastError?: string;
  sandboxReady?: boolean;
};

/** Shown when GET scrubbed secrets but a credential still exists server-side. */
export const MASKED_METRC_SECRET_PLACEHOLDER =
  "•••••••• configured — enter a new key only if you intend to replace the stored value.";

export function isMaskedMetrcSecretPlaceholder(value: unknown): boolean {
  const s = String(value ?? "").trim();
  if (!s) return false;
  if (s === MASKED_METRC_SECRET_PLACEHOLDER) return true;
  return s.includes("configured — enter a new key");
}

/**
 * Prepare `company.metrc` for PUT /api/config — never send scrubbed `has*` flags;
 * omit blank keys unless the operator edited that field (server merge preserves stored secrets).
 */
export function prepareMetrcSecretsForSave(
  metrc: MetrcCompanyConfig,
  touched: { vendorKey?: boolean; userKey?: boolean },
): MetrcCompanyConfig {
  const m = { ...metrc };
  delete m.hasMetrcVendorApiKey;
  delete m.hasMetrcUserApiKey;
  delete m.vendorApiKey;
  delete m.userApiKey;
  if (isMaskedMetrcSecretPlaceholder(m.apiKey)) m.apiKey = "";
  if (isMaskedMetrcSecretPlaceholder(m.userKey)) m.userKey = "";
  if (!touched.vendorKey) m.apiKey = "";
  if (!touched.userKey) m.userKey = "";
  return m;
}

export const defaultMetrcCompanyConfig: MetrcCompanyConfig = {
  apiKey: "",
  userKey: "",
  username: "",
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
