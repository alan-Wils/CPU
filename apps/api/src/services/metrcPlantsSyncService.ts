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
import type { MetrcPlantGrowthPhaseList } from "../lib/metrcPlantsActiveQuery.js";
import { parseMetrcPlantsPayload, type ParsedMetrcPlant } from "../lib/metrcPlantsParse.js";
import { shouldFetchNextMetrcCollectionPage } from "../lib/metrcCollectionResponse.js";
import { isMetrcSandboxPlaceholderLicense } from "../lib/metrcOperationalStatus.js";
import type { MetrcEnvironment } from "../lib/metrcResolveBaseUrl.js";
import {
  listMetrcPlantsForCompany,
  upsertMetrcPlantsForCompany,
} from "../repositories/metrcPlantRepository.js";

const MAX_PLANT_PAGES = 50;
const PHASES: MetrcPlantGrowthPhaseList[] = ["flowering", "vegetative"];

export type MetrcPlantDto = {
  metrcPlantId: string;
  label: string;
  sourcePlantBatchId: string;
  sourcePlantBatchName: string;
  strainName: string;
  growthPhase: string;
  metrcLocationId: string;
  locationName: string;
  plantedDate: string | null;
  active: boolean;
  licenseNumber: string;
  lastSyncedAt: string;
};

export type MetrcPlantsSyncSuccess = {
  ok: true;
  count: number;
  plants: MetrcPlantDto[];
  durationMs: number;
  endpoints: string[];
};

export type MetrcPlantsSyncFailure = {
  ok: false;
  status: number;
  message: string;
  credentialHint?: string;
};

export type MetrcPlantsSyncResponse = MetrcPlantsSyncSuccess | MetrcPlantsSyncFailure;

function dbRowToDto(row: Awaited<ReturnType<typeof listMetrcPlantsForCompany>>[number]): MetrcPlantDto {
  return {
    metrcPlantId: row.metrcPlantId,
    label: row.label,
    sourcePlantBatchId: row.sourcePlantBatchId,
    sourcePlantBatchName: row.sourcePlantBatchName,
    strainName: row.strainName,
    growthPhase: row.growthPhase,
    metrcLocationId: row.metrcLocationId,
    locationName: row.locationName,
    plantedDate: row.plantedDate ? row.plantedDate.toISOString() : null,
    active: row.active,
    licenseNumber: row.licenseNumber,
    lastSyncedAt: row.lastSyncedAt.toISOString(),
  };
}

function mergeParsed(pages: ParsedMetrcPlant[][]): ParsedMetrcPlant[] {
  const byLabel = new Map<string, ParsedMetrcPlant>();
  for (const page of pages) {
    for (const row of page) {
      byLabel.set(row.label, row);
    }
  }
  return [...byLabel.values()];
}

export class MetrcPlantsSyncService {
  async listSyncedPlants(companyId: string, metrcPlantBatchId?: string): Promise<MetrcPlantDto[]> {
    const rows = await listMetrcPlantsForCompany(companyId, metrcPlantBatchId);
    return rows.map(dbRowToDto);
  }

  async syncMetrcPlants(input: {
    companyId: string;
    actorUserId: string;
  }): Promise<MetrcPlantsSyncResponse> {
    logInfo("[METRC] plants_sync_start", { companyId: input.companyId });

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
        message: "Facility license number is required for METRC plant sync.",
      };
    }

    const client = MetrcClient.fromLoadedConfig(loaded, input.companyId);
    const endpointCtx = {
      stateCode: loaded.stateCode || "CO",
      environment: loaded.environment as MetrcEnvironment,
    };

    if (isMetrcSandboxPlaceholderLicense(license)) {
      const locationsRequest = await resolveMetrcLocationsActiveRequest({
        client,
        loaded,
        companyId: input.companyId,
        purpose: "plants_sync",
      });
      license = locationsRequest.params.licenseNumber;
    }

    const locationsRequest = await resolveMetrcLocationsActiveRequest({
      client,
      loaded: { ...loaded, licenseNumber: license },
      companyId: input.companyId,
      purpose: "plants_sync",
    });

    const startedAt = Date.now();
    const allParsed: ParsedMetrcPlant[] = [];
    const endpointsUsed: string[] = [];
    let lastStatus = 502;
    let lastMessage = "METRC plant sync failed.";

    for (const phase of PHASES) {
      const resource = phase === "flowering" ? ("plants_flowering" as const) : ("plants_vegetative" as const);
      for (let pageNumber = 1; pageNumber <= MAX_PLANT_PAGES; pageNumber += 1) {
        const pageParams = { ...locationsRequest.params, pageNumber };
        const candidates = orderMetrcEndpointCandidates(endpointCtx, resource, pageParams);
        let pageParsed: ParsedMetrcPlant[] | null = null;
        let pagePayload: unknown | undefined;

        for (let i = 0; i < candidates.length; i += 1) {
          const candidatePath = candidates[i]!;
          const result = await client.get<unknown>(candidatePath);

          if (!isMetrcClientFailure(result)) {
            cacheMetrcEndpointPath(endpointCtx, resource, candidatePath);
            endpointsUsed.push(metrcEndpointPathKey(candidatePath));
            pageParsed = parseMetrcPlantsPayload(result.data, phase);
            pagePayload = result.data;
            lastStatus = result.status;
            break;
          }

          lastStatus = result.status || 502;
          lastMessage = metrcPullFailureMessage(lastStatus, result.metrcMessage || result.message);

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
          if (lastStatus === 401 || lastStatus === 403) {
            logMetrcCredentialDiagnostics({
              companyId: input.companyId,
              purpose: "plants_sync",
              userKeyLength: loaded.userApiKey.length,
              vendorKeyLength: loaded.vendorApiKey.length,
              licensePresent: Boolean(license),
            });
          }
          logWarn("[METRC] plants_sync_failed", {
            companyId: input.companyId,
            phase,
            status: lastStatus,
            message: lastMessage,
          });
          return {
            ok: false,
            status: lastStatus,
            message: lastMessage,
            credentialHint:
              lastStatus === 401 || lastStatus === 403
                ? buildMetrcCredentialHintFromLoaded(loaded)
                : undefined,
          };
        }

        allParsed.push(...pageParsed);
        if (
          !shouldFetchNextMetrcCollectionPage({
            pageNumber,
            maxPages: MAX_PLANT_PAGES,
            pageSize: pageParams.pageSize,
            payload: pagePayload,
          })
        ) {
          break;
        }
      }
    }

    const parsed = mergeParsed([allParsed]);
    const syncedAt = new Date();
    await upsertMetrcPlantsForCompany(
      input.companyId,
      parsed.map((row) => ({
        metrcPlantId: row.metrcPlantId,
        label: row.label,
        licenseNumber: license,
        sourcePlantBatchId: row.sourcePlantBatchId,
        sourcePlantBatchName: row.sourcePlantBatchName,
        strainName: row.strainName,
        growthPhase: row.growthPhase,
        metrcLocationId: row.metrcLocationId,
        locationName: row.locationName,
        plantedDate: row.plantedDate,
        active: row.active,
        rawPayloadJson: JSON.stringify(row.raw),
        lastSyncedAt: syncedAt,
      })),
    );

    const persisted = await listMetrcPlantsForCompany(input.companyId);
    const durationMs = Date.now() - startedAt;

    logInfo("[METRC] plants_sync_success", {
      companyId: input.companyId,
      count: persisted.length,
      durationMs,
    });

    return {
      ok: true,
      count: persisted.length,
      plants: persisted.map(dbRowToDto),
      durationMs,
      endpoints: [...new Set(endpointsUsed)],
    };
  }
}
