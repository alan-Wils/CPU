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

/**
 * Colorado sandbox–compatible routes (v1 for most resources; packages stay v2).
 * Facilities/strains/items include v2 fallbacks when v1 is unavailable.
 */
export function buildMetrcEndpointCandidates(
  resource: MetrcEndpointResource,
  licenseNumber: string,
): string[] {
  const license = String(licenseNumber || "").trim();
  const q = license ? `?licenseNumber=${encodeURIComponent(license)}` : "";

  switch (resource) {
    case "facilities":
      return ["/facilities/v1/active", "/facilities/v2/", "/facilities/v2/active"];
    case "strains":
      return [`/strains/v1/active${q}`, `/strains/v2/active${q}`];
    case "items":
      return [`/items/v1/active${q}`, `/items/v2/active${q}`];
    case "rooms":
      return [`/locations/v1/active${q}`, `/locations/v2/active${q}`];
    case "packages":
      return [`/packages/v2/active${q}`];
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
  if (failure.status === 404) return true;
  if (resource === "facilities" || resource === "strains" || resource === "items") {
    if (failure.status >= 500 && failure.status < 600) return true;
  }
  return false;
}
