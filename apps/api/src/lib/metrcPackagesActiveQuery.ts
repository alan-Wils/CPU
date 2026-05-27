import type { MetrcLocationsActiveQueryParams } from "./metrcLocationsActiveQuery.js";
import {
  buildMetrcLocationsActiveQueryString,
  formatMetrcDateYmd,
} from "./metrcLocationsActiveQuery.js";

/** Wide window for post-create active list fallback (30 days back, 1 day forward). */
export function buildWideMetrcPackagesActiveDateRange(): {
  lastModifiedStart: string;
  lastModifiedEnd: string;
} {
  const today = new Date();
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 30);
  return {
    lastModifiedStart: formatMetrcDateYmd(start),
    lastModifiedEnd: formatMetrcDateYmd(end),
  };
}

export type MetrcPackagesActiveQueryParams = MetrcLocationsActiveQueryParams;

export function buildMetrcPackagesActiveQueryString(params: MetrcPackagesActiveQueryParams): string {
  return buildMetrcLocationsActiveQueryString(params);
}

export function buildMetrcPackagesActivePathCandidates(params: MetrcPackagesActiveQueryParams): string[] {
  const q = buildMetrcPackagesActiveQueryString(params);
  return [`/packages/v2/active${q}`, `/packages/v1/active${q}`];
}
