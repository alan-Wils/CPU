import type { MetrcLocationsActiveQueryParams } from "./metrcLocationsActiveQuery.js";
import { buildMetrcLocationsActiveQueryString } from "./metrcLocationsActiveQuery.js";

export type MetrcPackagesActiveQueryParams = MetrcLocationsActiveQueryParams;

export function buildMetrcPackagesActiveQueryString(params: MetrcPackagesActiveQueryParams): string {
  return buildMetrcLocationsActiveQueryString(params);
}

export function buildMetrcPackagesActivePathCandidates(params: MetrcPackagesActiveQueryParams): string[] {
  const q = buildMetrcPackagesActiveQueryString(params);
  return [`/packages/v2/active${q}`, `/packages/v1/active${q}`];
}
