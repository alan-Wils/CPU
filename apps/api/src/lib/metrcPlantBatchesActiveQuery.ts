import type { MetrcLocationsActiveQueryParams } from "./metrcLocationsActiveQuery.js";
import { buildMetrcLocationsActiveQueryString } from "./metrcLocationsActiveQuery.js";

export type MetrcPlantBatchesActiveQueryParams = MetrcLocationsActiveQueryParams;

export function buildMetrcPlantBatchesActiveQueryString(
  params: MetrcPlantBatchesActiveQueryParams,
): string {
  return buildMetrcLocationsActiveQueryString(params);
}

export function buildMetrcPlantBatchesActivePathname(
  params: MetrcPlantBatchesActiveQueryParams,
): string {
  return `/plantbatches/v2/active${buildMetrcPlantBatchesActiveQueryString(params)}`;
}

export function buildMetrcPlantBatchesActivePathCandidates(
  params: MetrcPlantBatchesActiveQueryParams,
): string[] {
  const q = buildMetrcPlantBatchesActiveQueryString(params);
  return [`/plantbatches/v2/active${q}`, `/plantbatches/v1/active${q}`];
}

export function buildMetrcPlantBatchesActivePathForPage(
  params: MetrcPlantBatchesActiveQueryParams,
  pageNumber: number,
): string {
  return buildMetrcPlantBatchesActivePathname({ ...params, pageNumber });
}
