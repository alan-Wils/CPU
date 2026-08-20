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
  metrcEndpointPathKey,
  metrcPullFailureMessage,
  orderMetrcEndpointCandidates,
  shouldTryNextMetrcEndpoint,
} from "../lib/metrcEndpoints.js";
import { resolveMetrcLocationsActiveRequest } from "../lib/metrcLocationsActiveQuery.js";
import { parseMetrcPlantBatchesPayload, type ParsedMetrcPlantBatch } from "../lib/metrcPlantBatchesParse.js";
import { shouldFetchNextMetrcCollectionPage } from "../lib/metrcCollectionResponse.js";
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
  appendMetrcPlantBatchRequestLog,
  listMetrcPlantBatchesForCompany,
  upsertMetrcPlantBatchesForCompany,
} from "../repositories/metrcPlantBatchRepository.js";

const MAX_PLANT_BATCH_PAGES = 50;

export type MetrcPlantBatchDto = {
  metrcPlantBatchId: string;
  name: string;
  strainName: string;
  metrcStrainId: string | null;
  count: number;
  metrcLocationId: string;
  locationName: string;
  plantedDate: string | null;
  lastModified: string | null;
  active: boolean;
  licenseNumber: string;
  createdViaTest: boolean;
  lastSyncedAt: string;
};

export type MetrcPlantBatchesSyncSuccess = {
  ok: true;
  syncedAt: string;
  count: number;
  totalPlantBatchesSynced: number;
  lastPlantBatchesSync: string;
  plantBatches: MetrcPlantBatchDto[];
  durationMs: number;
  retries: number;
  rateLimitWarning: string | null;
  endpoint: string;
  pagesFetched: number;
};

export type MetrcPlantBatchesSyncFailure = {
  ok: false;
  status: number;
  message: string;
  credentialHint?: string;
  endpoint?: string;
};

export type MetrcPlantBatchesSyncResponse =
  | MetrcPlantBatchesSyncSuccess
  | MetrcPlantBatchesSyncFailure;

function dbRowToDto(row: Awaited<ReturnType<typeof listMetrcPlantBatchesForCompany>>[number]): MetrcPlantBatchDto {
  return {
    metrcPlantBatchId: row.metrcPlantBatchId,
    name: row.name,
    strainName: row.strainName,
    metrcStrainId: row.metrcStrainId,
    count: row.count,
    metrcLocationId: row.metrcLocationId,
    locationName: row.locationName,
    plantedDate: row.plantedDate ? row.plantedDate.toISOString() : null,
    lastModified: row.lastModified ? row.lastModified.toISOString() : null,
    active: row.active,
    licenseNumber: row.licenseNumber,
    createdViaTest: row.createdViaTest,
    lastSyncedAt: row.lastSyncedAt.toISOString(),
  };
}

function mergeParsedPages(pages: ParsedMetrcPlantBatch[][]): ParsedMetrcPlantBatch[] {
  const byId = new Map<string, ParsedMetrcPlantBatch>();
  for (const page of pages) {
    for (const row of page) {
      byId.set(row.metrcPlantBatchId, row);
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export class MetrcPlantBatchesSyncService {
  configService = new ConfigService();

  async listSyncedPlantBatches(companyId: string): Promise<MetrcPlantBatchDto[]> {
    const rows = await listMetrcPlantBatchesForCompany(companyId);
    return rows.map(dbRowToDto);
  }

  async syncMetrcPlantBatches(input: {
    companyId: string;
    actorUserId: string;
  }): Promise<MetrcPlantBatchesSyncResponse> {
    logInfo("[METRC] plant_batches_sync_start", { companyId: input.companyId });

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
        message: "Facility license number is required for METRC plant batch sync.",
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
        purpose: "plant_batches_sync",
      });
      operationalLicense = locationsRequest.params.licenseNumber;
      license = operationalLicense;
    }

    const locationsRequest = await resolveMetrcLocationsActiveRequest({
      client,
      loaded: { ...loaded, licenseNumber: license },
      companyId: input.companyId,
      purpose: "plant_batches_sync",
    });

    const startedAt = Date.now();
    let totalRetries = 0;
    let totalRateLimitWaitedMs = 0;
    let lastEndpointKey = metrcEndpointPathKey(locationsRequest.pathnameAndQuery);
    const pageResults: ParsedMetrcPlantBatch[][] = [];
    let pagesFetched = 0;
    let lastStatus = 502;
    let lastMessage = "METRC plant batch sync failed.";
    let lastEndpoint: string | undefined;

    for (let pageNumber = 1; pageNumber <= MAX_PLANT_BATCH_PAGES; pageNumber += 1) {
      const pageParams = { ...locationsRequest.params, pageNumber };
      const candidates = orderMetrcEndpointCandidates(endpointCtx, "plant_batches", pageParams);
      let pageParsed: ParsedMetrcPlantBatch[] | null = null;
      let pagePayload: unknown | undefined;

      for (let i = 0; i < candidates.length; i += 1) {
        const candidatePath = candidates[i]!;
        const result = await client.get<unknown>(candidatePath);

        if (!isMetrcClientFailure(result)) {
          cacheMetrcEndpointPath(endpointCtx, "plant_batches", candidatePath);
          lastEndpointKey = metrcEndpointPathKey(candidatePath);
          pageParsed = parseMetrcPlantBatchesPayload(result.data);
          pagePayload = result.data;
          totalRetries += result.retries;
          totalRateLimitWaitedMs += result.rateLimitWaitedMs;
          lastStatus = result.status;
          break;
        }

        lastStatus = result.status || 502;
        lastMessage = metrcPullFailureMessage(lastStatus, result.metrcMessage || result.message);
        lastEndpoint = result.endpoint ?? candidatePath.split("?")[0];

        if (
          shouldTryNextMetrcEndpoint("plant_batches", i, candidates.length, {
            status: result.status,
            upstreamType: result.upstreamError?.type,
          })
        ) {
          continue;
        }
        break;
      }

      if (!pageParsed) {
        await appendMetrcPlantBatchRequestLog({
          companyId: input.companyId,
          action: "sync_active",
          method: "GET",
          endpoint: lastEndpoint ?? lastEndpointKey,
          httpStatus: lastStatus,
          requestPayload: { licenseNumber: operationalLicense, pageNumber, pageParams },
          responsePayload: { ok: false, message: lastMessage, status: lastStatus },
          durationMs: Date.now() - startedAt,
          actorUserId: input.actorUserId,
        });

        if (lastStatus === 401 || lastStatus === 403) {
          logMetrcCredentialDiagnostics({
            companyId: input.companyId,
            purpose: "plant_batches_sync",
            userKeyLength: loaded.userApiKey.length,
            vendorKeyLength: loaded.vendorApiKey.length,
            licensePresent: Boolean(loaded.licenseNumber),
          });
        }

        logWarn("[METRC] plant_batches_sync_failed", {
          companyId: input.companyId,
          status: lastStatus,
          endpoint: lastEndpoint,
          message: lastMessage,
          pageNumber,
        });

        return {
          ok: false,
          status: lastStatus,
          message: lastMessage,
          credentialHint:
            lastStatus === 401 || lastStatus === 403
              ? buildMetrcCredentialHintFromLoaded(loaded)
              : undefined,
          endpoint: lastEndpoint,
        };
      }

      pagesFetched += 1;
      pageResults.push(pageParsed);
      if (
        !shouldFetchNextMetrcCollectionPage({
          pageNumber,
          maxPages: MAX_PLANT_BATCH_PAGES,
          pageSize: pageParams.pageSize,
          payload: pagePayload,
        })
      ) {
        break;
      }
    }

    const parsed = mergeParsedPages(pageResults);
    const syncedAt = new Date();
    const syncedAtIso = syncedAt.toISOString();
    const durationMs = Date.now() - startedAt;
    const rateLimitWarning =
      totalRateLimitWaitedMs > 0
        ? `Rate limiter delayed requests by ${totalRateLimitWaitedMs}ms.`
        : totalRetries > 0
          ? `Completed after ${totalRetries} retries.`
          : null;

    await upsertMetrcPlantBatchesForCompany(
      input.companyId,
      parsed.map((row) => ({
        metrcPlantBatchId: row.metrcPlantBatchId,
        licenseNumber: operationalLicense,
        name: row.name,
        strainName: row.strainName,
        metrcStrainId: row.metrcStrainId,
        count: row.count,
        metrcLocationId: row.metrcLocationId,
        locationName: row.locationName,
        plantedDate: row.plantedDate,
        lastModified: row.lastModified,
        active: row.active,
        createdViaTest: false,
        rawPayloadJson: JSON.stringify(row.raw),
        lastSyncedAt: syncedAt,
      })),
    );

    const totalPlantBatchesSynced = parsed.length;

    let nextMetrc = applyMetrcOperationalSuccess(
      {
        ...loaded.metrc,
        metrcSandboxLastPlantBatchesSyncAt: syncedAtIso,
        metrcLastPlantBatchesSyncAt: syncedAtIso,
        lastPlantBatchesSync: syncedAtIso,
        metrcSandboxLastPlantBatchesCount: totalPlantBatchesSynced,
      },
      { operationalLicense, facilityName: null },
    );
    nextMetrc = applyMetrcSuccessStatus(nextMetrc, {
      httpStatus: 200,
      message: formatMetrcSuccessMessage({
        kind: "plant_batches_sync",
        count: totalPlantBatchesSynced,
      }),
      checkedAt: syncedAtIso,
      totalPlantBatchesSynced,
    });

    await this.configService.upsert({
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      key: "company",
      value: { ...loaded.company, metrc: nextMetrc },
    });

    const persisted = await listMetrcPlantBatchesForCompany(input.companyId);
    const plantBatches = persisted.map(dbRowToDto);

    await appendMetrcPlantBatchRequestLog({
      companyId: input.companyId,
      action: "sync_active",
      method: "GET",
      endpoint: lastEndpointKey,
      httpStatus: 200,
      requestPayload: {
        licenseNumber: operationalLicense,
        pagesFetched,
        query: locationsRequest.params,
      },
      responsePayload: {
        ok: true,
        count: totalPlantBatchesSynced,
        pagesFetched,
        endpoint: lastEndpointKey,
      },
      durationMs,
      actorUserId: input.actorUserId,
    });

    logInfo("[METRC] plant_batches_sync_success", {
      companyId: input.companyId,
      endpoint: lastEndpointKey,
      count: totalPlantBatchesSynced,
      pagesFetched,
      durationMs,
    });

    return {
      ok: true,
      syncedAt: syncedAtIso,
      count: totalPlantBatchesSynced,
      totalPlantBatchesSynced,
      lastPlantBatchesSync: syncedAtIso,
      plantBatches,
      durationMs,
      retries: totalRetries,
      rateLimitWarning,
      endpoint: lastEndpointKey,
      pagesFetched,
    };
  }
}
