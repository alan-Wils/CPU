import { ConfigService } from "./configService.js";
import { logInfo, logWarn } from "../lib/logger.js";
import { MetrcClient, isMetrcClientFailure } from "../lib/metrcClient.js";
import { loadCompanyMetrcConfig } from "../lib/metrcConfigLoader.js";
import {
  buildMetrcCredentialHintFromLoaded,
  logMetrcCredentialDiagnostics,
} from "../lib/metrcCredentialDiagnostics.js";
import {
  cacheMetrcEndpointPath,
  getCachedMetrcEndpointPath,
  metrcEndpointPathKey,
  metrcPullFailureMessage,
  shouldTryNextMetrcEndpoint,
  type MetrcEndpointResource,
} from "../lib/metrcEndpoints.js";
import {
  parseMetrcFacilityLicenseRows,
  resolveMetrcLocationsActiveRequest,
} from "../lib/metrcLocationsActiveQuery.js";
import {
  extractMetrcListPagination,
  metrcDataRecordCount,
} from "../lib/metrcConnectionHelpers.js";
import {
  normalizeMetrcCollectionRecords,
  shouldFetchNextMetrcCollectionPage,
} from "../lib/metrcCollectionResponse.js";
import {
  parseMetrcTransfersPayload,
  type ParsedMetrcTransfer,
} from "../lib/metrcTransfersParse.js";
import {
  buildMetrcTransfersListPathCandidates,
  buildMetrcTransfersSyncQueryParamVariants,
  type MetrcTransfersListDirection,
  type MetrcTransfersListQueryParams,
} from "../lib/metrcTransfersActiveQuery.js";
import {
  applyMetrcOperationalSuccess,
  isMetrcSandboxPlaceholderLicense,
} from "../lib/metrcOperationalStatus.js";
import {
  applyMetrcSuccessStatus,
  formatMetrcSuccessMessage,
} from "../lib/metrcStatusPersistence.js";
import type { MetrcEnvironment } from "../lib/metrcResolveBaseUrl.js";
import {
  appendMetrcTransferRequestLog,
  listMetrcTransfersForCompany,
  upsertMetrcTransfersForCompany,
} from "../repositories/metrcTransferRepository.js";

const MAX_TRANSFER_PAGES = 50;
const TRANSFER_DIRECTIONS: MetrcTransfersListDirection[] = ["incoming", "outgoing", "template"];

const DIRECTION_ENDPOINT_RESOURCE: Record<
  MetrcTransfersListDirection,
  MetrcEndpointResource
> = {
  incoming: "transfers_incoming",
  outgoing: "transfers_outgoing",
  template: "transfers_templates",
};

export type MetrcTransferDto = {
  metrcTransferId: string;
  direction: string;
  manifestNumber: string;
  transferType: string;
  status: string;
  licenseNumber: string;
  transporter: string;
  destinationFacility: string;
  packageLabels: string[];
  plannedRoute: string;
  plannedDate: string | null;
  createdViaTest: boolean;
  lastSyncedAt: string;
};

export type MetrcTransfersSyncDiagnostics = {
  licenseNumber: string;
  endpoints: Array<{
    direction: MetrcTransfersListDirection;
    url: string;
    params: Record<string, unknown>;
    httpStatus: number | null;
    rawRecordCount: number;
    parsedCount: number;
    pagination: Record<string, unknown> | null;
    firstRawItem: Record<string, unknown> | null;
    dateFiltersOmitted: boolean;
    paramVariantIndex: number;
  }>;
};

export type MetrcTransfersSyncSuccess = {
  ok: true;
  syncedAt: string;
  count: number;
  totalTransfersSynced: number;
  lastTransfersSync: string;
  transfers: MetrcTransferDto[];
  durationMs: number;
  retries: number;
  rateLimitWarning: string | null;
  endpoint: string;
  pagesFetched: number;
  diagnostics: MetrcTransfersSyncDiagnostics;
};

export type MetrcTransfersSyncFailure = {
  ok: false;
  status: number;
  message: string;
  credentialHint?: string;
  endpoint?: string;
  diagnostics?: MetrcTransfersSyncDiagnostics;
};

export type MetrcTransfersSyncResponse = MetrcTransfersSyncSuccess | MetrcTransfersSyncFailure;

function dbRowToDto(row: Awaited<ReturnType<typeof listMetrcTransfersForCompany>>[number]): MetrcTransferDto {
  let packageLabels: string[] = [];
  try {
    const parsed = JSON.parse(row.packageLabelsJson || "[]");
    if (Array.isArray(parsed)) {
      packageLabels = parsed.map((v) => String(v ?? "").trim()).filter(Boolean);
    }
  } catch {
    packageLabels = [];
  }
  return {
    metrcTransferId: row.metrcTransferId,
    direction: row.direction,
    manifestNumber: row.manifestNumber,
    transferType: row.transferType,
    status: row.status,
    licenseNumber: row.licenseNumber,
    transporter: row.transporter,
    destinationFacility: row.destinationFacility,
    packageLabels,
    plannedRoute: row.plannedRoute,
    plannedDate: row.plannedDate ? row.plannedDate.toISOString() : null,
    createdViaTest: row.createdViaTest,
    lastSyncedAt: row.lastSyncedAt.toISOString(),
  };
}

function mergeParsedTransfers(pages: ParsedMetrcTransfer[][]): ParsedMetrcTransfer[] {
  const byKey = new Map<string, ParsedMetrcTransfer>();
  for (const page of pages) {
    for (const row of page) {
      byKey.set(`${row.direction}:${row.metrcTransferId}`, row);
    }
  }
  return [...byKey.values()].sort((a, b) =>
    `${a.direction}:${a.manifestNumber}`.localeCompare(`${b.direction}:${b.manifestNumber}`),
  );
}

export class MetrcTransfersSyncService {
  configService = new ConfigService();

  async listSyncedTransfers(companyId: string): Promise<MetrcTransferDto[]> {
    const rows = await listMetrcTransfersForCompany(companyId);
    return rows.map(dbRowToDto);
  }

  async syncMetrcTransfers(input: {
    companyId: string;
    actorUserId: string;
  }): Promise<MetrcTransfersSyncResponse> {
    logInfo("[METRC] transfers_sync_start", { companyId: input.companyId });

    const loaded = await loadCompanyMetrcConfig(input.companyId);
    if (!loaded) {
      return { ok: false, status: 404, message: "Company configuration not found." };
    }

    if (!loaded.userApiKey) {
      return {
        ok: false,
        status: 400,
        message: "User API key is required. Run sandbox setup or save a user key in Company Config.",
      };
    }

    let license = loaded.licenseNumber;
    if (!license) {
      return {
        ok: false,
        status: 400,
        message: "Facility license number is required for METRC transfer sync.",
      };
    }

    const client = MetrcClient.fromLoadedConfig(loaded, input.companyId);
    const endpointCtx = {
      stateCode: loaded.stateCode || "CO",
      environment: loaded.environment as MetrcEnvironment,
    };

    let operationalLicense = license;
    if (isMetrcSandboxPlaceholderLicense(license)) {
      const locationsRequest = await resolveMetrcLocationsActiveRequest({
        client,
        loaded,
        companyId: input.companyId,
        purpose: "transfers_sync",
      });
      operationalLicense = locationsRequest.params.licenseNumber;
      license = operationalLicense;
    }

    await resolveMetrcLocationsActiveRequest({
      client,
      loaded: { ...loaded, licenseNumber: license },
      companyId: input.companyId,
      purpose: "transfers_sync",
    });

    let facilityStartDate: string | null = null;
    const facilitiesResult = await client.get<unknown>("/facilities/v2/");
    if (!isMetrcClientFailure(facilitiesResult)) {
      const facilityRows = parseMetrcFacilityLicenseRows(facilitiesResult.data);
      facilityStartDate =
        facilityRows.find((row) => row.licenseNumber === operationalLicense)?.startDate ?? null;
    }

    const pageSize = 20;
    const startedAt = Date.now();
    let totalRetries = 0;
    let totalRateLimitWaitedMs = 0;
    let pagesFetched = 0;
    const allParsed: ParsedMetrcTransfer[] = [];
    const diagnostics: MetrcTransfersSyncDiagnostics = {
      licenseNumber: operationalLicense,
      endpoints: [],
    };

    for (const direction of TRANSFER_DIRECTIONS) {
      const resource = DIRECTION_ENDPOINT_RESOURCE[direction];
      const directionPages: ParsedMetrcTransfer[][] = [];
      const paramVariants = buildMetrcTransfersSyncQueryParamVariants({
        direction,
        licenseNumber: operationalLicense,
        environment: loaded.environment as MetrcEnvironment,
        facilityStartDate,
        pageSize,
      });

      let directionSynced = false;

      for (let variantIndex = 0; variantIndex < paramVariants.length; variantIndex += 1) {
        if (directionSynced) break;

        const baseParams = paramVariants[variantIndex]!;
        const variantPages: ParsedMetrcTransfer[][] = [];
        let variantRawTotal = 0;
        let directionLastStatus: number | null = null;
        let directionEndpointKey = "";
        let directionFirstRaw: Record<string, unknown> | null = null;
        let lastPagination: Record<string, unknown> | null = null;

        for (let pageNumber = 1; pageNumber <= MAX_TRANSFER_PAGES; pageNumber += 1) {
          const pageParams: MetrcTransfersListQueryParams = { ...baseParams, pageNumber };
          const built = buildMetrcTransfersListPathCandidates(direction, pageParams);
          const cached = getCachedMetrcEndpointPath(endpointCtx, resource);
          const candidates = cached
            ? [
                built.find((p) => metrcEndpointPathKey(p) === cached) ?? built[0]!,
                ...built.filter((p) => metrcEndpointPathKey(p) !== cached),
              ]
            : built;
          let pageParsed: ParsedMetrcTransfer[] | null = null;
          let pageRawCount = 0;
          let pagePagination: Record<string, unknown> | null = null;
          let pagePayload: unknown | undefined;

          for (let i = 0; i < candidates.length; i += 1) {
            const candidatePath = candidates[i]!;
            const result = await client.get<unknown>(candidatePath);

            if (!isMetrcClientFailure(result)) {
              cacheMetrcEndpointPath(endpointCtx, resource, candidatePath);
              directionEndpointKey = metrcEndpointPathKey(candidatePath);
              pageRawCount = metrcDataRecordCount(result.data);
              pagePagination = extractMetrcListPagination(result.data);
              pageParsed = parseMetrcTransfersPayload(result.data, direction);
              pagePayload = result.data;
              totalRetries += result.retries;
              totalRateLimitWaitedMs += result.rateLimitWaitedMs;
              directionLastStatus = result.status;
              if (!directionFirstRaw) {
                const rawRows = parseMetrcTransfersPayload(result.data, direction);
                directionFirstRaw = rawRows[0]?.raw ?? null;
                if (!directionFirstRaw) {
                  const first = normalizeMetrcCollectionRecords(result.data)[0];
                  directionFirstRaw =
                    first && typeof first === "object" ? (first as Record<string, unknown>) : null;
                }
              }
              break;
            }

            directionLastStatus = result.status || 502;
            if (
              shouldTryNextMetrcEndpoint(resource, i, candidates.length, {
                status: result.status,
                upstreamType: result.upstreamError?.type,
              })
            ) {
              continue;
            }
            break;
          }

          if (!pageParsed) {
            logWarn("[METRC] transfers_sync_page_failed", {
              companyId: input.companyId,
              direction,
              variantIndex,
              pageNumber,
              status: directionLastStatus,
              params: pageParams,
            });
            diagnostics.endpoints.push({
              direction,
              url: directionEndpointKey || resource,
              params: {
                ...pageParams,
                licenseNumber: operationalLicense,
                dateFiltersOmitted: !pageParams.lastModifiedStart,
              },
              httpStatus: directionLastStatus,
              rawRecordCount: 0,
              parsedCount: 0,
              pagination: null,
              firstRawItem: null,
              dateFiltersOmitted: !pageParams.lastModifiedStart,
              paramVariantIndex: variantIndex,
            });
            break;
          }

          pagesFetched += 1;
          variantPages.push(pageParsed);
          variantRawTotal += pageRawCount;
          lastPagination = pagePagination;

          const parsedOnPage = pageParsed.length;
          logInfo("[METRC] transfers_sync_page", {
            companyId: input.companyId,
            direction,
            variantIndex,
            pageNumber,
            licenseNumber: operationalLicense,
            params: pageParams,
            httpStatus: directionLastStatus,
            rawRecordCount: pageRawCount,
            parsedCount: parsedOnPage,
            pagination: pagePagination,
            firstRawItem: directionFirstRaw,
            endpoint: directionEndpointKey,
          });

          diagnostics.endpoints.push({
            direction,
            url: directionEndpointKey,
            params: {
              ...pageParams,
              licenseNumber: operationalLicense,
              dateFiltersOmitted: !pageParams.lastModifiedStart,
            },
            httpStatus: directionLastStatus,
            rawRecordCount: pageRawCount,
            parsedCount: parsedOnPage,
            pagination: pagePagination,
            firstRawItem: directionFirstRaw,
            dateFiltersOmitted: !pageParams.lastModifiedStart,
            paramVariantIndex: variantIndex,
          });

          if (
            !shouldFetchNextMetrcCollectionPage({
              pageNumber,
              maxPages: MAX_TRANSFER_PAGES,
              pageSize: pageParams.pageSize,
              recordsOnPage: pageRawCount,
              payload: pagePayload,
            })
          ) {
            break;
          }
        }

        const mergedVariant = mergeParsedTransfers(variantPages);
        if (mergedVariant.length > 0) {
          directionPages.push(...variantPages);
          directionSynced = true;
          logInfo("[METRC] transfers_sync_direction_complete", {
            companyId: input.companyId,
            direction,
            variantIndex,
            licenseNumber: operationalLicense,
            rawRecordCount: variantRawTotal,
            parsedCount: mergedVariant.length,
            pagination: lastPagination,
          });
        } else if (variantIndex < paramVariants.length - 1) {
          logWarn("[METRC] transfers_sync_direction_retry_wider_query", {
            companyId: input.companyId,
            direction,
            variantIndex,
            licenseNumber: operationalLicense,
          });
        }
      }

      allParsed.push(...mergeParsedTransfers(directionPages));
    }

    logInfo("[METRC] transfers_sync_diagnostics", {
      companyId: input.companyId,
      licenseNumber: operationalLicense,
      diagnostics,
    });

    const parsed = mergeParsedTransfers([allParsed]);
    const syncedAt = new Date();
    const syncedAtIso = syncedAt.toISOString();
    const durationMs = Date.now() - startedAt;
    const rateLimitWarning =
      totalRateLimitWaitedMs > 0
        ? `Rate limiter delayed requests by ${totalRateLimitWaitedMs}ms.`
        : totalRetries > 0
          ? `Completed after ${totalRetries} retries.`
          : null;

    await upsertMetrcTransfersForCompany(
      input.companyId,
      parsed.map((row) => ({
        metrcTransferId: row.metrcTransferId,
        direction: row.direction,
        manifestNumber: row.manifestNumber,
        transferType: row.transferType,
        status: row.status,
        licenseNumber: operationalLicense,
        transporter: row.transporter,
        destinationFacility: row.destinationFacility,
        packageLabelsJson: JSON.stringify(row.packageLabels),
        plannedRoute: row.plannedRoute,
        plannedDate: row.plannedDate,
        createdViaTest: false,
        rawPayloadJson: JSON.stringify(row.raw),
        lastSyncedAt: syncedAt,
      })),
    );

    const totalTransfersSynced = parsed.length;

    let nextMetrc = applyMetrcOperationalSuccess(
      {
        ...loaded.metrc,
        metrcSandboxLastTransfersSyncAt: syncedAtIso,
        metrcLastTransfersSyncAt: syncedAtIso,
        lastTransfersSync: syncedAtIso,
        metrcSandboxLastTransfersCount: totalTransfersSynced,
      },
      { operationalLicense, facilityName: null },
    );
    nextMetrc = applyMetrcSuccessStatus(nextMetrc, {
      httpStatus: 200,
      message: formatMetrcSuccessMessage({
        kind: "transfers_sync",
        count: totalTransfersSynced,
      }),
      checkedAt: syncedAtIso,
      totalTransfersSynced,
    });

    await this.configService.upsert({
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      key: "company",
      value: { ...loaded.company, metrc: nextMetrc },
    });

    const persisted = await listMetrcTransfersForCompany(input.companyId);
    const transfers = persisted.map(dbRowToDto);

    await appendMetrcTransferRequestLog({
      companyId: input.companyId,
      action: "sync_lists",
      method: "GET",
      endpoint: "transfers/v2",
      httpStatus: 200,
      requestPayload: {
        licenseNumber: operationalLicense,
        pagesFetched,
        directions: TRANSFER_DIRECTIONS,
        facilityStartDate,
      },
      responsePayload: {
        ok: true,
        count: totalTransfersSynced,
        pagesFetched,
        diagnostics,
      },
      durationMs,
      actorUserId: input.actorUserId,
    });

    logInfo("[METRC] transfers_sync_success", {
      companyId: input.companyId,
      count: totalTransfersSynced,
      pagesFetched,
      durationMs,
    });

    return {
      ok: true,
      syncedAt: syncedAtIso,
      count: totalTransfersSynced,
      totalTransfersSynced,
      lastTransfersSync: syncedAtIso,
      transfers,
      durationMs,
      retries: totalRetries,
      rateLimitWarning,
      endpoint: "transfers/v2",
      pagesFetched,
      diagnostics,
    };
  }
}
