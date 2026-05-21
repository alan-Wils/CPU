import type { MetrcEnvironment } from "./metrcResolveBaseUrl.js";

export type MetrcEndpointResource =
  | "facilities"
  | "strains"
  | "items"
  | "rooms"
  | "packages";

export type MetrcEndpointContext = {
  stateCode: string;
  environment: MetrcEnvironment;
};

export const METRC_ENDPOINT_NOT_AVAILABLE_MESSAGE =
  "METRC endpoint not available for this resource (HTTP 404).";

/** Path without query string — used for version cache keys. */
export function metrcEndpointPathKey(pathnameAndQuery: string): string {
  return pathnameAndQuery.split("?")[0] || pathnameAndQuery;
}

function endpointCacheKey(ctx: MetrcEndpointContext, resource: MetrcEndpointResource): string {
  const st = String(ctx.stateCode || "CO")
    .trim()
    .toUpperCase();
  const env = ctx.environment === "sandbox" ? "sandbox" : "production";
  return `${st}:${env}:${resource}`;
}

const endpointPathCache = new Map<string, string>();

/** @internal test helper */
export function clearMetrcEndpointCache(): void {
  endpointPathCache.clear();
}

export function cacheMetrcEndpointPath(
  ctx: MetrcEndpointContext,
  resource: MetrcEndpointResource,
  pathnameAndQuery: string,
): void {
  endpointPathCache.set(endpointCacheKey(ctx, resource), metrcEndpointPathKey(pathnameAndQuery));
}

export function getCachedMetrcEndpointPath(
  ctx: MetrcEndpointContext,
  resource: MetrcEndpointResource,
): string | null {
  return endpointPathCache.get(endpointCacheKey(ctx, resource)) ?? null;
}

function licenseQuery(licenseNumber: string): string {
  const license = String(licenseNumber || "").trim();
  return license ? `?licenseNumber=${encodeURIComponent(license)}` : "";
}

/**
 * Colorado sandbox routes: license-scoped v2/active first, then v1/active.
 * Facilities: optional `/facilities/v2/` only (no v2/active).
 */
export function buildMetrcEndpointCandidates(
  resource: MetrcEndpointResource,
  licenseNumber: string,
): string[] {
  const q = licenseQuery(licenseNumber);

  switch (resource) {
    case "facilities":
      return ["/facilities/v2/"];
    case "rooms":
      return [`/locations/v2/active${q}`, `/locations/v1/active${q}`];
    case "strains":
      return [`/strains/v2/active${q}`, `/strains/v1/active${q}`];
    case "items":
      return [`/items/v2/active${q}`, `/items/v1/active${q}`];
    case "packages":
      return [`/packages/v2/active${q}`, `/packages/v1/active${q}`];
    default:
      return [];
  }
}

/** Prefer last successful path for this state/environment/resource. */
export function orderMetrcEndpointCandidates(
  ctx: MetrcEndpointContext,
  resource: MetrcEndpointResource,
  licenseNumber: string,
): string[] {
  const base = buildMetrcEndpointCandidates(resource, licenseNumber);
  const cached = getCachedMetrcEndpointPath(ctx, resource);
  if (!cached) return base;
  const preferred = base.find((p) => metrcEndpointPathKey(p) === cached);
  if (!preferred) return base;
  return [preferred, ...base.filter((p) => p !== preferred)];
}

/** Whether to try the next endpoint candidate after a failed request. */
export function shouldTryNextMetrcEndpoint(
  resource: MetrcEndpointResource,
  candidateIndex: number,
  candidateCount: number,
  failure: { status: number; upstreamType?: string },
): boolean {
  if (candidateIndex >= candidateCount - 1) return false;
  if (failure.upstreamType === "html_runtime_error") return true;
  if (resource === "facilities") return false;
  if (failure.status === 404) return true;
  if (failure.status >= 500 && failure.status < 600) return true;
  return false;
}

export function metrcPullFailureMessage(status: number, fallbackMessage: string): string {
  if (status === 404) return METRC_ENDPOINT_NOT_AVAILABLE_MESSAGE;
  return fallbackMessage;
}
