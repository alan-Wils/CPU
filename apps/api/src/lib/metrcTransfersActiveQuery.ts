import {
  formatMetrcDateYmd,
  type MetrcLocationsActiveQueryParams,
} from "./metrcLocationsActiveQuery.js";
import type { MetrcEnvironment } from "./metrcResolveBaseUrl.js";

export type MetrcTransfersListDirection = "incoming" | "outgoing" | "template";

/** Transfer list query — date filters optional (templates in sandbox omit them). */
export type MetrcTransfersListQueryParams = {
  licenseNumber: string;
  pageNumber: number;
  pageSize: number;
  lastModifiedStart?: string;
  lastModifiedEnd?: string;
};

/** @deprecated Use MetrcTransfersListQueryParams */
export type MetrcTransfersActiveQueryParams = MetrcTransfersListQueryParams;

const DEFAULT_PAGE_NUMBER = 1;
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_LOOKBACK_DAYS = 30;
const SANDBOX_TRANSFERS_LOOKBACK_DAYS = 365;

export function buildMetrcTransfersListQueryString(params: MetrcTransfersListQueryParams): string {
  const q = new URLSearchParams();
  q.set("licenseNumber", params.licenseNumber);
  if (params.lastModifiedStart) q.set("lastModifiedStart", params.lastModifiedStart);
  if (params.lastModifiedEnd) q.set("lastModifiedEnd", params.lastModifiedEnd);
  q.set("pageNumber", String(params.pageNumber));
  q.set("pageSize", String(params.pageSize));
  return `?${q.toString()}`;
}

export function buildMetrcTransfersListPathname(
  direction: MetrcTransfersListDirection,
  params: MetrcTransfersListQueryParams,
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
  params: MetrcTransfersListQueryParams,
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
  params: MetrcTransfersListQueryParams,
  pageNumber: number,
): string {
  return buildMetrcTransfersListPathname(direction, { ...params, pageNumber });
}

function sandboxTransfersDateRange(): { lastModifiedStart: string; lastModifiedEnd: string } {
  const today = new Date();
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - SANDBOX_TRANSFERS_LOOKBACK_DAYS);
  return {
    lastModifiedStart: formatMetrcDateYmd(start),
    lastModifiedEnd: formatMetrcDateYmd(today),
  };
}

function defaultTransfersDateRange(facilityStartDate: string | null): {
  lastModifiedStart: string;
  lastModifiedEnd: string;
} {
  const today = new Date();
  const lastModifiedEnd = formatMetrcDateYmd(today);
  if (facilityStartDate) {
    return { lastModifiedStart: facilityStartDate, lastModifiedEnd };
  }
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - DEFAULT_LOOKBACK_DAYS);
  return { lastModifiedStart: formatMetrcDateYmd(start), lastModifiedEnd };
}

export function buildMetrcTransfersSyncQueryParams(input: {
  direction: MetrcTransfersListDirection;
  licenseNumber: string;
  environment: MetrcEnvironment;
  facilityStartDate: string | null;
  pageNumber?: number;
  pageSize?: number;
  includeDateFilters?: boolean;
}): MetrcTransfersListQueryParams {
  const licenseNumber = String(input.licenseNumber || "").trim();
  const base: MetrcTransfersListQueryParams = {
    licenseNumber,
    pageNumber: input.pageNumber ?? DEFAULT_PAGE_NUMBER,
    pageSize: input.pageSize ?? DEFAULT_PAGE_SIZE,
  };
  const env = String(input.environment || "").trim().toLowerCase();
  const includeDates = input.includeDateFilters !== false;

  if (input.direction === "template" && env === "sandbox" && !includeDates) {
    return base;
  }

  const dates =
    env === "sandbox"
      ? sandboxTransfersDateRange()
      : defaultTransfersDateRange(input.facilityStartDate);
  return { ...base, ...dates };
}

/** Sandbox templates: try without date filters first, then 365-day window. */
export function buildMetrcTransfersSyncQueryParamVariants(input: {
  direction: MetrcTransfersListDirection;
  licenseNumber: string;
  environment: MetrcEnvironment;
  facilityStartDate: string | null;
  pageNumber?: number;
  pageSize?: number;
}): MetrcTransfersListQueryParams[] {
  const env = String(input.environment || "").trim().toLowerCase();
  if (input.direction === "template" && env === "sandbox") {
    return [
      buildMetrcTransfersSyncQueryParams({ ...input, includeDateFilters: false }),
      buildMetrcTransfersSyncQueryParams({ ...input, includeDateFilters: true }),
    ];
  }
  return [buildMetrcTransfersSyncQueryParams({ ...input, includeDateFilters: true })];
}

/** Bridge for callers still using locations-style params. */
export function metrcTransfersQueryFromLocationsParams(
  params: MetrcLocationsActiveQueryParams,
): MetrcTransfersListQueryParams {
  return {
    licenseNumber: params.licenseNumber,
    pageNumber: params.pageNumber,
    pageSize: params.pageSize,
    lastModifiedStart: params.lastModifiedStart,
    lastModifiedEnd: params.lastModifiedEnd,
  };
}
