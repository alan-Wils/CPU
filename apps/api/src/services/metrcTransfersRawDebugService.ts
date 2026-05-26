import { MetrcClient, isMetrcClientFailure } from "../lib/metrcClient.js";
import { loadCompanyMetrcConfig } from "../lib/metrcConfigLoader.js";
import {
  extractMetrcListPagination,
  metrcDataRecordCount,
} from "../lib/metrcConnectionHelpers.js";
import { parseMetrcFacilityLicenseRows } from "../lib/metrcLocationsActiveQuery.js";
import { buildMetrcTransfersListPathname } from "../lib/metrcTransfersActiveQuery.js";
import { isMetrcSandboxPlaceholderLicense } from "../lib/metrcOperationalStatus.js";
import { resolveMetrcLocationsActiveRequest } from "../lib/metrcLocationsActiveQuery.js";
import {
  buildMetrcTransfersSyncQueryParamVariants,
  type MetrcTransfersListDirection,
} from "../lib/metrcTransfersActiveQuery.js";

export type MetrcTransfersRawDebugEndpointResult = {
  direction: MetrcTransfersListDirection;
  pathname: string;
  params: Record<string, unknown>;
  httpStatus: number | null;
  rawRecordCount: number;
  pagination: Record<string, unknown> | null;
  firstRawItem: unknown;
  raw: unknown;
  error?: string;
};

export type MetrcTransfersRawDebugResponse = {
  ok: boolean;
  licenseNumber: string;
  environment: string;
  endpoints: MetrcTransfersRawDebugEndpointResult[];
};

const DEBUG_DIRECTIONS: MetrcTransfersListDirection[] = ["incoming", "outgoing", "template"];

export class MetrcTransfersRawDebugService {
  async fetchRawTransfers(input: { companyId: string }): Promise<MetrcTransfersRawDebugResponse> {
    const loaded = await loadCompanyMetrcConfig(input.companyId);
    if (!loaded) {
      return { ok: false, licenseNumber: "", environment: "", endpoints: [] };
    }

    let license = String(loaded.licenseNumber || "").trim();
    const client = MetrcClient.fromLoadedConfig(loaded, input.companyId);

    if (isMetrcSandboxPlaceholderLicense(license)) {
      const locationsRequest = await resolveMetrcLocationsActiveRequest({
        client,
        loaded,
        companyId: input.companyId,
        purpose: "transfers_raw_debug",
      });
      license = locationsRequest.params.licenseNumber;
    }

    let facilityStartDate: string | null = null;
    const facilitiesResult = await client.get<unknown>("/facilities/v2/");
    if (!isMetrcClientFailure(facilitiesResult)) {
      const rows = parseMetrcFacilityLicenseRows(facilitiesResult.data);
      facilityStartDate = rows.find((row) => row.licenseNumber === license)?.startDate ?? null;
    }

    const endpoints: MetrcTransfersRawDebugEndpointResult[] = [];

    for (const direction of DEBUG_DIRECTIONS) {
      const paramVariants = buildMetrcTransfersSyncQueryParamVariants({
        direction,
        licenseNumber: license,
        environment: loaded.environment,
        facilityStartDate,
        pageNumber: 1,
        pageSize: 20,
      });

      const params = paramVariants[0]!;
      const pathname = buildMetrcTransfersListPathname(direction, params);
      const result = await client.get<unknown>(pathname);

      if (isMetrcClientFailure(result)) {
        endpoints.push({
          direction,
          pathname,
          params: { ...params },
          httpStatus: result.status || null,
          rawRecordCount: 0,
          pagination: null,
          firstRawItem: null,
          raw: result,
          error: result.metrcMessage || result.message,
        });
        continue;
      }

      const rawRecords = metrcDataRecordCount(result.data);
      const dataRecords =
        result.data && typeof result.data === "object" && Array.isArray((result.data as { Data?: unknown }).Data)
          ? ((result.data as { Data: unknown[] }).Data[0] ?? null)
          : null;

      endpoints.push({
        direction,
        pathname,
        params: { ...params, dateFiltersOmitted: !params.lastModifiedStart },
        httpStatus: result.status,
        rawRecordCount: rawRecords,
        pagination: extractMetrcListPagination(result.data),
        firstRawItem: dataRecords,
        raw: result.data,
      });
    }

    return {
      ok: true,
      licenseNumber: license,
      environment: loaded.environment,
      endpoints,
    };
  }
}
