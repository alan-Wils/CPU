import type { MetrcLocationsActiveQueryParams } from "./metrcLocationsActiveQuery.js";
import { buildMetrcLocationsActiveQueryString } from "./metrcLocationsActiveQuery.js";

export type MetrcHarvestsActiveQueryParams = MetrcLocationsActiveQueryParams;

export function buildMetrcHarvestsActiveQueryString(params: MetrcHarvestsActiveQueryParams): string {
  return buildMetrcLocationsActiveQueryString(params);
}

export function buildMetrcHarvestsActivePathname(params: MetrcHarvestsActiveQueryParams): string {
  return `/harvests/v2/active${buildMetrcHarvestsActiveQueryString(params)}`;
}

export function buildMetrcHarvestsActivePathCandidates(params: MetrcHarvestsActiveQueryParams): string[] {
  const q = buildMetrcHarvestsActiveQueryString(params);
  return [`/harvests/v2/active${q}`, `/harvests/v1/active${q}`];
}

export function buildMetrcHarvestsActivePathForPage(
  params: MetrcHarvestsActiveQueryParams,
  pageNumber: number,
): string {
  return buildMetrcHarvestsActivePathname({ ...params, pageNumber });
}
