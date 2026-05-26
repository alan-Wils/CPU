import type { MetrcLocationsActiveQueryParams } from "./metrcLocationsActiveQuery.js";
import { buildMetrcLocationsActiveQueryString } from "./metrcLocationsActiveQuery.js";

export type MetrcItemsActiveQueryParams = MetrcLocationsActiveQueryParams;

export function buildMetrcItemsActiveQueryString(params: MetrcItemsActiveQueryParams): string {
  return buildMetrcLocationsActiveQueryString(params);
}

export function buildMetrcItemsActivePathname(params: MetrcItemsActiveQueryParams): string {
  return `/items/v2/active${buildMetrcItemsActiveQueryString(params)}`;
}

export function buildMetrcItemsActivePathCandidates(params: MetrcItemsActiveQueryParams): string[] {
  const q = buildMetrcItemsActiveQueryString(params);
  return [`/items/v2/active${q}`, `/items/v1/active${q}`];
}

export function buildMetrcItemsActivePathForPage(
  params: MetrcItemsActiveQueryParams,
  pageNumber: number,
): string {
  return buildMetrcItemsActivePathname({ ...params, pageNumber });
}
