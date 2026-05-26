import { logInfo } from "./logger.js";
import { parseMetrcDataRecords } from "./metrcConnectionHelpers.js";
import type { MetrcClient } from "./metrcClient.js";
import { isMetrcClientFailure } from "./metrcClient.js";
import type { LoadedMetrcConfig } from "./metrcConfigLoader.js";

export type MetrcLocationsActiveQueryParams = {
  licenseNumber: string;
  lastModifiedStart: string;
  lastModifiedEnd: string;
  pageNumber: number;
  pageSize: number;
};

export type MetrcFacilityLicenseRow = {
  licenseNumber: string;
  startDate: string | null;
};

const DEFAULT_PAGE_NUMBER = 1;
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_LOOKBACK_DAYS = 30;

export function formatMetrcDateYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseMetrcFacilityStartDate(value: unknown): string | null {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const datePart = s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
  const parsed = new Date(datePart);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatMetrcDateYmd(parsed);
}

export function parseMetrcFacilityLicenseRows(body: unknown): MetrcFacilityLicenseRow[] {
  return parseMetrcDataRecords(body)
    .map((row) => {
      const licenseNumber = String(
        row.LicenseNumber ?? row.licenseNumber ?? row.FacilityLicenseNumber ?? "",
      ).trim();
      if (!licenseNumber) return null;
      const startDate = parseMetrcFacilityStartDate(
        row.StartDate ?? row.startDate ?? row.FacilityStartDate ?? row.facilityStartDate,
      );
      return { licenseNumber, startDate };
    })
    .filter((r): r is MetrcFacilityLicenseRow => r !== null);
}

export function pickMetrcFacilityLicenseRow(
  facilities: MetrcFacilityLicenseRow[],
  configLicense: string,
): MetrcFacilityLicenseRow | null {
  if (!facilities.length) return null;
  const cfg = String(configLicense || "").trim();
  if (cfg) {
    const exact = facilities.find((f) => f.licenseNumber === cfg);
    if (exact) return exact;
  }
  return facilities[0] ?? null;
}

export function defaultMetrcLocationsDateRange(facilityStartDate: string | null): {
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

export function buildMetrcLocationsActiveQueryString(params: MetrcLocationsActiveQueryParams): string {
  const q = new URLSearchParams();
  q.set("licenseNumber", params.licenseNumber);
  q.set("lastModifiedStart", params.lastModifiedStart);
  q.set("lastModifiedEnd", params.lastModifiedEnd);
  q.set("pageNumber", String(params.pageNumber));
  q.set("pageSize", String(params.pageSize));
  return `?${q.toString()}`;
}

export function buildMetrcLocationsActivePathname(params: MetrcLocationsActiveQueryParams): string {
  return `/locations/v2/active${buildMetrcLocationsActiveQueryString(params)}`;
}

export function buildMetrcLocationsActivePathCandidates(
  params: MetrcLocationsActiveQueryParams,
): string[] {
  const q = buildMetrcLocationsActiveQueryString(params);
  return [`/locations/v2/active${q}`, `/locations/v1/active${q}`];
}

export function buildMetrcLocationsActiveParams(input: {
  facility: MetrcFacilityLicenseRow | null;
  configLicense: string;
  pageNumber?: number;
  pageSize?: number;
}): MetrcLocationsActiveQueryParams {
  const facility = input.facility;
  const licenseNumber =
    facility?.licenseNumber || String(input.configLicense || "").trim();
  const dates = defaultMetrcLocationsDateRange(facility?.startDate ?? null);
  return {
    licenseNumber,
    lastModifiedStart: dates.lastModifiedStart,
    lastModifiedEnd: dates.lastModifiedEnd,
    pageNumber: input.pageNumber ?? DEFAULT_PAGE_NUMBER,
    pageSize: input.pageSize ?? DEFAULT_PAGE_SIZE,
  };
}

export function logMetrcLocationsActiveRequest(input: {
  companyId?: string;
  purpose: string;
  baseUrl: string | null;
  pathnameAndQuery: string;
  params: MetrcLocationsActiveQueryParams;
  facilitySource: string;
}): void {
  const base = String(input.baseUrl || "").replace(/\/+$/, "");
  const path = input.pathnameAndQuery.startsWith("/")
    ? input.pathnameAndQuery
    : `/${input.pathnameAndQuery}`;
  logInfo("[METRC] locations_active_request", {
    companyId: input.companyId ?? null,
    purpose: input.purpose,
    facilitySource: input.facilitySource,
    resolvedUrl: base ? `${base}${path}` : path,
    licenseNumber: input.params.licenseNumber,
    lastModifiedStart: input.params.lastModifiedStart,
    lastModifiedEnd: input.params.lastModifiedEnd,
    pageNumber: input.params.pageNumber,
    pageSize: input.params.pageSize,
  });
}

export async function resolveMetrcLocationsActiveRequest(input: {
  client: MetrcClient;
  loaded: LoadedMetrcConfig;
  companyId?: string;
  purpose: string;
  pageNumber?: number;
  pageSize?: number;
}): Promise<{
  params: MetrcLocationsActiveQueryParams;
  pathnameAndQuery: string;
  candidates: string[];
  facilitySource: string;
}> {
  const configLicense = input.loaded.licenseNumber;
  let facility: MetrcFacilityLicenseRow | null = null;
  let facilitySource = "config_license_fallback";

  const facilitiesResult = await input.client.get<unknown>("/facilities/v2/");
  if (!isMetrcClientFailure(facilitiesResult)) {
    const rows = parseMetrcFacilityLicenseRows(facilitiesResult.data);
    const picked = pickMetrcFacilityLicenseRow(rows, configLicense);
    if (picked) {
      facility = picked;
      facilitySource =
        picked.licenseNumber === configLicense
          ? "facilities_endpoint_matched_config"
          : "facilities_endpoint_first";
    }
  }

  const params = buildMetrcLocationsActiveParams({
    facility,
    configLicense: input.loaded.licenseNumber,
    pageNumber: input.pageNumber,
    pageSize: input.pageSize,
  });
  const pathnameAndQuery = buildMetrcLocationsActivePathname(params);
  const candidates = buildMetrcLocationsActivePathCandidates(params);

  logMetrcLocationsActiveRequest({
    companyId: input.companyId,
    purpose: input.purpose,
    baseUrl: input.client.baseUrl,
    pathnameAndQuery,
    params,
    facilitySource,
  });

  return { params, pathnameAndQuery, candidates, facilitySource };
}
