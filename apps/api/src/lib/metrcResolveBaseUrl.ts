/**
 * METRC REST base URL (server-side). Mirrors `lib/metrcCompanyConfig.ts` in the web app.
 */

export type MetrcEnvironment = "production" | "sandbox";

export type MetrcBaseUrlInput = {
  stateCode?: string;
  environment?: MetrcEnvironment;
  apiBaseUrlOverride?: string;
};

export function resolveMetrcApiBaseUrl(m: MetrcBaseUrlInput): string | null {
  const override = String(m.apiBaseUrlOverride || "")
    .trim()
    .replace(/\/+$/, "");
  if (override) return override;

  const state = String(m.stateCode || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) return null;

  const st = state.toLowerCase();
  const sandbox = m.environment === "sandbox";

  if (sandbox) {
    return `https://sandbox-api-${st}.metrc.com`;
  }
  return `https://api-${st}.metrc.com`;
}
