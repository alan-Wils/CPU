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
import { parseMetrcHarvestsPayload, type ParsedMetrcHarvest } from "../lib/metrcHarvestsParse.js";
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
  appendMetrcHarvestRequestLog,
  listMetrcHarvestsForCompany,
  upsertMetrcHarvestsForCompany,
} from "../repositories/metrcHarvestRepository.js";

const MAX_HARVEST_PAGES = 50;

export type MetrcHarvestDto = {
  metrcHarvestId: string;
  harvestName: string;
  sourcePlantBatchId: string;
  sourcePlantBatchName: string;
  strainName: string;
  metrcLocationId: string;
  locationName: string;
  harvestType: string;
  wetWeight: number;
  totalWeight: number;
  unitOfWeight: string;
  patientLicenseNumber: string;
  plantedDate: string | null;
  finishedDate: string | null;
  active: boolean;
  licenseNumber: string;
  createdViaTest: boolean;
  lastSyncedAt: string;
};

export type MetrcHarvestsSyncSuccess = {
  ok: true;
  syncedAt: string;
  count: number;
  totalHarvestsSynced: number;
  lastHarvestsSync: string;
  harvests: MetrcHarvestDto[];
  durationMs: number;
  retries: number;
  rateLimitWarning: string | null;
  endpoint: string;
  pagesFetched: number;
};

export type MetrcHarvestsSyncFailure = {
  ok: false;
  status: number;
  message: string;
  credentialHint?: string;
  endpoint?: string;
};

export type MetrcHarvestsSyncResponse = MetrcHarvestsSyncSuccess | MetrcHarvestsSyncFailure;

function dbRowToDto(row: Awaited<ReturnType<typeof listMetrcHarvestsForCompany>>[number]): MetrcHarvestDto {
  return {
    metrcHarvestId: row.metrcHarvestId,
    harvestName: row.harvestName,
    sourcePlantBatchId: row.sourcePlantBatchId,
    sourcePlantBatchName: row.sourcePlantBatchName,
    strainName: row.strainName,
    metrcLocationId: row.metrcLocationId,
    locationName: row.locationName,
    harvestType: row.harvestType,
    wetWeight: row.wetWeight,
    totalWeight: row.totalWeight,
    unitOfWeight: row.unitOfWeight,
    patientLicenseNumber: row.patientLicenseNumber,
    plantedDate: row.plantedDate ? row.plantedDate.toISOString() : null,
    finishedDate: row.finishedDate ? row.finishedDate.toISOString() : null,
    active: row.active,
    licenseNumber: row.licenseNumber,
    createdViaTest: row.createdViaTest,
    lastSyncedAt: row.lastSyncedAt.toISOString(),
  };
}

function mergeParsedPages(pages: ParsedMetrcHarvest[][]): ParsedMetrcHarvest[] {
  const byId = new Map<string, ParsedMetrcHarvest>();
  for (const page of pages) {
    for (const row of page) {
      byId.set(row.metrcHarvestId, row);
    }
  }
  return [...byId.values()].sort((a, b) => a.harvestName.localeCompare(b.harvestName));
}

export class MetrcHarvestsSyncService {
  configService = new ConfigService();

  async listSyncedHarvests(companyId: string): Promise<MetrcHarvestDto[]> {
    const rows = await listMetrcHarvestsForCompany(companyId);
    return rows.map(dbRowToDto);
  }

  async syncMetrcHarvests(input: {
    companyId: string;
    actorUserId: string;
  }): Promise<MetrcHarvestsSyncResponse> {
    logInfo("[METRC] harvests_sync_start", { companyId: input.companyId });

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
        message: "Facility license number is required for METRC harvest sync.",
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
        purpose: "harvests_sync",
      });
      operationalLicense = locationsRequest.params.licenseNumber;
      license = operationalLicense;
    }

    const locationsRequest = await resolveMetrcLocationsActiveRequest({
      client,
      loaded: { ...loaded, licenseNumber: license },
      companyId: input.companyId,
      purpose: "harvests_sync",
    });

    const startedAt = Date.now();
    let totalRetries = 0;
    let totalRateLimitWaitedMs = 0;
    let lastEndpointKey = metrcEndpointPathKey(locationsRequest.pathnameAndQuery);
    const pageResults: ParsedMetrcHarvest[][] = [];
    let pagesFetched = 0;
    let lastStatus = 502;
    let lastMessage = "METRC harvest sync failed.";
    let lastEndpoint: string | undefined;

    for (let pageNumber = 1; pageNumber <= MAX_HARVEST_PAGES; pageNumber += 1) {
      const pageParams = { ...locationsRequest.params, pageNumber };
      const candidates = orderMetrcEndpointCandidates(endpointCtx, "harvests", pageParams);
      let pageParsed: ParsedMetrcHarvest[] | null = null;

      for (let i = 0; i < candidates.length; i += 1) {
        const candidatePath = candidates[i]!;
        const result = await client.get<unknown>(candidatePath);

        if (!isMetrcClientFailure(result)) {
          cacheMetrcEndpointPath(endpointCtx, "harvests", candidatePath);
          lastEndpointKey = metrcEndpointPathKey(candidatePath);
          pageParsed = parseMetrcHarvestsPayload(result.data);
          totalRetries += result.retries;
          totalRateLimitWaitedMs += result.rateLimitWaitedMs;
          lastStatus = result.status;
          break;
        }

        lastStatus = result.status || 502;
        lastMessage = metrcPullFailureMessage(lastStatus, result.metrcMessage || result.message);
        lastEndpoint = result.endpoint ?? candidatePath.split("?")[0];

        if (
          shouldTryNextMetrcEndpoint("harvests", i, candidates.length, {
            status: result.status,
            upstreamType: result.upstreamError?.type,
          })
        ) {
          continue;
        }
        break;
      }

      if (!pageParsed) {
        await appendMetrcHarvestRequestLog({
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
            purpose: "harvests_sync",
            userKeyLength: loaded.userApiKey.length,
            vendorKeyLength: loaded.vendorApiKey.length,
            licensePresent: Boolean(loaded.licenseNumber),
          });
        }

        logWarn("[METRC] harvests_sync_failed", {
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
      if (pageParsed.length < pageParams.pageSize) break;
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

    await upsertMetrcHarvestsForCompany(
      input.companyId,
      parsed.map((row) => ({
        metrcHarvestId: row.metrcHarvestId,
        licenseNumber: operationalLicense,
        harvestName: row.harvestName,
        sourcePlantBatchId: row.sourcePlantBatchId,
        sourcePlantBatchName: row.sourcePlantBatchName,
        strainName: row.strainName,
        metrcLocationId: row.metrcLocationId,
        locationName: row.locationName,
        harvestType: row.harvestType,
        wetWeight: row.wetWeight,
        totalWeight: row.totalWeight,
        unitOfWeight: row.unitOfWeight,
        patientLicenseNumber: row.patientLicenseNumber,
        plantedDate: row.plantedDate,
        finishedDate: row.finishedDate,
        active: row.active,
        createdViaTest: false,
        rawPayloadJson: JSON.stringify(row.raw),
        lastModified: row.lastModified,
        lastSyncedAt: syncedAt,
      })),
    );

    const totalHarvestsSynced = parsed.length;

    let nextMetrc = applyMetrcOperationalSuccess(
      {
        ...loaded.metrc,
        metrcSandboxLastHarvestsSyncAt: syncedAtIso,
        metrcLastHarvestsSyncAt: syncedAtIso,
        lastHarvestsSync: syncedAtIso,
        metrcSandboxLastHarvestsCount: totalHarvestsSynced,
      },
      { operationalLicense, facilityName: null },
    );
    nextMetrc = applyMetrcSuccessStatus(nextMetrc, {
      httpStatus: 200,
      message: formatMetrcSuccessMessage({
        kind: "harvests_sync",
        count: totalHarvestsSynced,
      }),
      checkedAt: syncedAtIso,
      totalHarvestsSynced,
    });

    await this.configService.upsert({
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      key: "company",
      value: { ...loaded.company, metrc: nextMetrc },
    });

    const persisted = await listMetrcHarvestsForCompany(input.companyId);
    const harvests = persisted.map(dbRowToDto);

    await appendMetrcHarvestRequestLog({
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
        count: totalHarvestsSynced,
        pagesFetched,
        endpoint: lastEndpointKey,
      },
      durationMs,
      actorUserId: input.actorUserId,
    });

    logInfo("[METRC] harvests_sync_success", {
      companyId: input.companyId,
      endpoint: lastEndpointKey,
      count: totalHarvestsSynced,
      pagesFetched,
      durationMs,
    });

    return {
      ok: true,
      syncedAt: syncedAtIso,
      count: totalHarvestsSynced,
      totalHarvestsSynced,
      lastHarvestsSync: syncedAtIso,
      harvests,
      durationMs,
      retries: totalRetries,
      rateLimitWarning,
      endpoint: lastEndpointKey,
      pagesFetched,
    };
  }
}
