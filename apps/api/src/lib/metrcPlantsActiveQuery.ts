import type { MetrcLocationsActiveQueryParams } from "./metrcLocationsActiveQuery.js";
import { buildMetrcLocationsActiveQueryString } from "./metrcLocationsActiveQuery.js";

export type MetrcPlantsActiveQueryParams = MetrcLocationsActiveQueryParams;

export type MetrcPlantGrowthPhaseList = "flowering" | "vegetative";

function buildPath(phase: MetrcPlantGrowthPhaseList, params: MetrcPlantsActiveQueryParams): string {
  const q = buildMetrcLocationsActiveQueryString(params);
  return `/plants/v2/${phase}${q}`;
}

export function buildMetrcPlantsActivePathCandidates(
  phase: MetrcPlantGrowthPhaseList,
  params: MetrcPlantsActiveQueryParams,
): string[] {
  const q = buildMetrcLocationsActiveQueryString(params);
  return [`/plants/v2/${phase}${q}`, `/plants/v1/${phase}${q}`];
}

export function buildMetrcPlantsActivePathForPage(
  phase: MetrcPlantGrowthPhaseList,
  params: MetrcPlantsActiveQueryParams,
  pageNumber: number,
): string {
  return buildPath(phase, { ...params, pageNumber });
}
