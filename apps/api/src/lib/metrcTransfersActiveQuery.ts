import type { MetrcLocationsActiveQueryParams } from "./metrcLocationsActiveQuery.js";
import { buildMetrcLocationsActiveQueryString } from "./metrcLocationsActiveQuery.js";

export type MetrcTransfersListDirection = "incoming" | "outgoing" | "template";

export type MetrcTransfersActiveQueryParams = MetrcLocationsActiveQueryParams;

export function buildMetrcTransfersListQueryString(params: MetrcTransfersActiveQueryParams): string {
  return buildMetrcLocationsActiveQueryString(params);
}

export function buildMetrcTransfersListPathname(
  direction: MetrcTransfersListDirection,
  params: MetrcTransfersActiveQueryParams,
): string {
  const q = buildMetrcTransfersListQueryString(params);
  switch (direction) {
    case "incoming":
      return `/transfers/v2/incoming${q}`;
    case "outgoing":
      return `/transfers/v2/outgoing${q}`;
    case "template":
      return `/transfers/v2/templates/outgoing${q}`;
    default:
      return `/transfers/v2/outgoing${q}`;
  }
}

export function buildMetrcTransfersListPathCandidates(
  direction: MetrcTransfersListDirection,
  params: MetrcTransfersActiveQueryParams,
): string[] {
  const q = buildMetrcTransfersListQueryString(params);
  switch (direction) {
    case "incoming":
      return [`/transfers/v2/incoming${q}`, `/transfers/v1/incoming${q}`];
    case "outgoing":
      return [`/transfers/v2/outgoing${q}`, `/transfers/v1/outgoing${q}`];
    case "template":
      return [`/transfers/v2/templates/outgoing${q}`, `/transfers/v1/templates${q}`];
    default:
      return [`/transfers/v2/outgoing${q}`, `/transfers/v1/outgoing${q}`];
  }
}

export function buildMetrcTransfersListPathForPage(
  direction: MetrcTransfersListDirection,
  params: MetrcTransfersActiveQueryParams,
  pageNumber: number,
): string {
  return buildMetrcTransfersListPathname(direction, { ...params, pageNumber });
}
