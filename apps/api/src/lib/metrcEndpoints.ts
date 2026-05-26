import type { MetrcEnvironment } from "./metrcResolveBaseUrl.js";
import {
  buildMetrcLocationsActivePathCandidates,
  type MetrcLocationsActiveQueryParams,
} from "./metrcLocationsActiveQuery.js";
import {
  buildMetrcHarvestsActivePathCandidates,
  type MetrcHarvestsActiveQueryParams,
} from "./metrcHarvestsActiveQuery.js";
import {
  buildMetrcPlantsActivePathCandidates,
  type MetrcPlantsActiveQueryParams,
} from "./metrcPlantsActiveQuery.js";
import {
  buildMetrcPlantBatchesActivePathCandidates,
  type MetrcPlantBatchesActiveQueryParams,
} from "./metrcPlantBatchesActiveQuery.js";
import {
  buildMetrcItemsActivePathCandidates,
  type MetrcItemsActiveQueryParams,
} from "./metrcItemsActiveQuery.js";

export type { MetrcLocationsActiveQueryParams };

export type MetrcEndpointResource =
  | "facilities"
  | "strains"
  | "items"
  | "rooms"
  | "packages"
  | "plant_batches"
  | "harvests"
  | "plants_flowering"
  | "plants_vegetative";

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
  licenseNumberOrLocationsParams: string | MetrcLocationsActiveQueryParams,
): string[] {
  switch (resource) {
    case "facilities":
      return ["/facilities/v2/"];
    case "rooms": {
      if (typeof licenseNumberOrLocationsParams !== "string") {
        return buildMetrcLocationsActivePathCandidates(licenseNumberOrLocationsParams);
      }
      const q = licenseQuery(licenseNumberOrLocationsParams);
      return [`/locations/v2/active${q}`, `/locations/v1/active${q}`];
    }
    case "strains": {
      const q = licenseQuery(String(licenseNumberOrLocationsParams));
      return [`/strains/v2/active${q}`, `/strains/v1/active${q}`];
    }
    case "items": {
      if (typeof licenseNumberOrLocationsParams !== "string") {
        return buildMetrcItemsActivePathCandidates(licenseNumberOrLocationsParams);
      }
      const q = licenseQuery(String(licenseNumberOrLocationsParams));
      return [`/items/v2/active${q}`, `/items/v1/active${q}`];
    }
    case "packages": {
      const q = licenseQuery(String(licenseNumberOrLocationsParams));
      return [`/packages/v2/active${q}`, `/packages/v1/active${q}`];
    }
    case "plant_batches": {
      if (typeof licenseNumberOrLocationsParams !== "string") {
        return buildMetrcPlantBatchesActivePathCandidates(licenseNumberOrLocationsParams);
      }
      const q = licenseQuery(String(licenseNumberOrLocationsParams));
      return [`/plantbatches/v2/active${q}`, `/plantbatches/v1/active${q}`];
    }
    case "harvests": {
      if (typeof licenseNumberOrLocationsParams !== "string") {
        return buildMetrcHarvestsActivePathCandidates(licenseNumberOrLocationsParams);
      }
      const q = licenseQuery(String(licenseNumberOrLocationsParams));
      return [`/harvests/v2/active${q}`, `/harvests/v1/active${q}`];
    }
    case "plants_flowering": {
      if (typeof licenseNumberOrLocationsParams !== "string") {
        return buildMetrcPlantsActivePathCandidates("flowering", licenseNumberOrLocationsParams);
      }
      const q = licenseQuery(String(licenseNumberOrLocationsParams));
      return [`/plants/v2/flowering${q}`, `/plants/v1/flowering${q}`];
    }
    case "plants_vegetative": {
      if (typeof licenseNumberOrLocationsParams !== "string") {
        return buildMetrcPlantsActivePathCandidates("vegetative", licenseNumberOrLocationsParams);
      }
      const q = licenseQuery(String(licenseNumberOrLocationsParams));
      return [`/plants/v2/vegetative${q}`, `/plants/v1/vegetative${q}`];
    }
    default:
      return [];
  }
}

/** Prefer last successful path for this state/environment/resource. */
export function orderMetrcEndpointCandidates(
  ctx: MetrcEndpointContext,
  resource: MetrcEndpointResource,
  licenseNumberOrLocationsParams: string | MetrcLocationsActiveQueryParams,
): string[] {
  const base = buildMetrcEndpointCandidates(resource, licenseNumberOrLocationsParams);
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
