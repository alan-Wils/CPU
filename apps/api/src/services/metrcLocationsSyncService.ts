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
import { parseMetrcLocationsPayload, type ParsedMetrcLocation } from "../lib/metrcLocationsParse.js";
import { suggestNexbatchRoomForMetrcLocation } from "../lib/metrcLocationRoomMatch.js";
import {
  findNexbatchRoomOption,
  formatNexbatchRoomLabel,
  parseNexbatchRoomOptionsFromCompanyValue,
  type NexbatchRoomOption,
  type NexbatchRoomSuite,
} from "../lib/metrcNexbatchRooms.js";
import {
  applyMetrcOperationalSuccess,
  pickMetrcFacilityNameFromLocations,
} from "../lib/metrcOperationalStatus.js";
import {
  applyMetrcSuccessStatus,
  formatMetrcSuccessMessage,
} from "../lib/metrcStatusPersistence.js";
import type { MetrcEnvironment } from "../lib/metrcResolveBaseUrl.js";
import {
  applyAutoMetrcLocationMappings,
  listMetrcLocationsForCompany,
  updateMetrcLocationMapping,
  upsertMetrcLocationsForCompany,
} from "../repositories/metrcLocationRepository.js";

export type MetrcLocationDto = {
  metrcLocationId: string;
  name: string;
  locationTypeId: number | null;
  locationTypeName: string;
  forPlants: boolean;
  forHarvests: boolean;
  forPackages: boolean;
  licenseNumber: string;
  nexbatchRoomSuite: NexbatchRoomSuite | null;
  nexbatchRoomId: string | null;
  nexbatchRoomLabel: string | null;
  mappingSource: "manual" | "auto" | "none";
  nexbatchMappingManual: boolean;
};

export type MetrcLocationsSyncSuccess = {
  ok: true;
  syncedAt: string;
  count: number;
  totalLocationsSynced: number;
  lastLocationsSync: string;
  locations: MetrcLocationDto[];
  durationMs: number;
  retries: number;
  rateLimitWarning: string | null;
  endpoint: string;
  nexbatchRooms: NexbatchRoomOption[];
  autoMappedCount: number;
};

export type MetrcLocationsSyncFailure = {
  ok: false;
  status: number;
  message: string;
  credentialHint?: string;
  endpoint?: string;
};

export type MetrcLocationsSyncResponse = MetrcLocationsSyncSuccess | MetrcLocationsSyncFailure;

function parseNexbatchSuite(raw: string | null | undefined): NexbatchRoomSuite | null {
  const s = String(raw ?? "").trim();
  if (s === "vegRooms" || s === "flowerRooms" || s === "dryRooms" || s === "freezers") {
    return s;
  }
  return null;
}

function resolveMappingSource(row: {
  nexbatchRoomId: string | null;
  nexbatchMappingManual: boolean;
}): MetrcLocationDto["mappingSource"] {
  if (!row.nexbatchRoomId) return "none";
  return row.nexbatchMappingManual ? "manual" : "auto";
}

function dbRowToDto(
  row: Awaited<ReturnType<typeof listMetrcLocationsForCompany>>[number],
  nexbatchRooms: NexbatchRoomOption[],
): MetrcLocationDto {
  const suite = parseNexbatchSuite(row.nexbatchRoomSuite);
  const matched = findNexbatchRoomOption(nexbatchRooms, suite, row.nexbatchRoomId);
  return {
    metrcLocationId: row.metrcLocationId,
    name: row.name,
    locationTypeId: row.locationTypeId,
    locationTypeName: row.locationTypeName,
    forPlants: row.forPlants,
    forHarvests: row.forHarvests,
    forPackages: row.forPackages,
    licenseNumber: row.licenseNumber,
    nexbatchRoomSuite: suite,
    nexbatchRoomId: row.nexbatchRoomId,
    nexbatchRoomLabel: matched ? formatNexbatchRoomLabel(matched) : null,
    mappingSource: resolveMappingSource(row),
    nexbatchMappingManual: row.nexbatchMappingManual,
  };
}

async function applyAutoRoomMappingsForCompany(input: {
  companyId: string;
  nexbatchRooms: NexbatchRoomOption[];
}): Promise<number> {
  const persisted = await listMetrcLocationsForCompany(input.companyId);
  const autoRows = [];
  for (const row of persisted) {
    if (row.nexbatchMappingManual || row.nexbatchRoomId) continue;
    const suggested = suggestNexbatchRoomForMetrcLocation(row.name, input.nexbatchRooms);
    if (!suggested) continue;
    autoRows.push({
      metrcLocationId: row.metrcLocationId,
      nexbatchRoomSuite: suggested.suite,
      nexbatchRoomId: suggested.roomId,
    });
  }
  if (!autoRows.length) return 0;
  await applyAutoMetrcLocationMappings(input.companyId, autoRows);
  logInfo("[METRC] locations_auto_mapped", {
    companyId: input.companyId,
    count: autoRows.length,
  });
  return autoRows.length;
}

export class MetrcLocationsSyncService {
  configService = new ConfigService();

  async loadNexbatchRoomOptions(companyId: string): Promise<NexbatchRoomOption[]> {
    const rows = await this.configService.list(companyId);
    const companyRow = rows.find((r) => r.key === "company");
    if (!companyRow?.value || typeof companyRow.value !== "object") return [];
    return parseNexbatchRoomOptionsFromCompanyValue(companyRow.value as Record<string, unknown>);
  }

  async syncMetrcLocations(input: {
    companyId: string;
    actorUserId: string;
  }): Promise<MetrcLocationsSyncResponse> {
    logInfo("[METRC] locations_sync_start", { companyId: input.companyId });

    const loaded = await loadCompanyMetrcConfig(input.companyId);
    if (!loaded) {
      logWarn("[METRC] locations_sync_failed", {
        companyId: input.companyId,
        status: 404,
        reason: "company_config_missing",
      });
      return { ok: false, status: 404, message: "Company configuration not found." };
    }

    if (!loaded.userApiKey) {
      logWarn("[METRC] locations_sync_failed", {
        companyId: input.companyId,
        status: 400,
        reason: "user_key_missing",
      });
      return {
        ok: false,
        status: 400,
        message: "User API key is required. Run sandbox setup or save a user key in Company Config.",
      };
    }

    const nexbatchRooms = await this.loadNexbatchRoomOptions(input.companyId);
    const client = MetrcClient.fromLoadedConfig(loaded, input.companyId);
    const endpointCtx = {
      stateCode: loaded.stateCode || "CO",
      environment: loaded.environment as MetrcEnvironment,
    };

    const locationsRequest = await resolveMetrcLocationsActiveRequest({
      client,
      loaded,
      companyId: input.companyId,
      purpose: "locations_sync",
    });
    const operationalLicense = locationsRequest.params.licenseNumber;
    const candidates = orderMetrcEndpointCandidates(
      endpointCtx,
      "rooms",
      locationsRequest.params,
    );

    let lastStatus = 502;
    let lastMessage = "METRC locations sync failed.";
    let lastEndpoint: string | undefined;

    for (let i = 0; i < candidates.length; i += 1) {
      const pathname = candidates[i]!;
      const result = await client.get<unknown>(pathname);

      if (!isMetrcClientFailure(result)) {
        cacheMetrcEndpointPath(endpointCtx, "rooms", pathname);
        const parsed = parseMetrcLocationsPayload(result.data);
        const syncedAt = new Date();
        const syncedAtIso = syncedAt.toISOString();
        const rateLimitWarning =
          result.rateLimitWaitedMs > 0
            ? `Rate limiter delayed this request by ${result.rateLimitWaitedMs}ms.`
            : result.retries > 0
              ? `Completed after ${result.retries} retries.`
              : null;

        await upsertMetrcLocationsForCompany(
          input.companyId,
          parsed.map((row) => ({
            metrcLocationId: row.metrcLocationId,
            licenseNumber: operationalLicense,
            name: row.name,
            locationTypeId: row.locationTypeId,
            locationTypeName: row.locationTypeName,
            forPlants: row.forPlants,
            forHarvests: row.forHarvests,
            forPackages: row.forPackages,
            rawPayloadJson: JSON.stringify(row.raw),
            lastSyncedAt: syncedAt,
          })),
        );

        const facilityName = pickMetrcFacilityNameFromLocations(parsed) ?? null;
        const totalLocationsSynced = parsed.length;

        let nextMetrc = applyMetrcOperationalSuccess(
          {
            ...loaded.metrc,
            metrcLastLocationsSyncAt: syncedAtIso,
            lastLocationsSync: syncedAtIso,
            metrcTotalLocationsSynced: totalLocationsSynced,
            metrcSandboxLastRoomsSyncAt: syncedAtIso,
            metrcSandboxLastRoomsCount: totalLocationsSynced,
            metrcSandboxLastRateLimitWarning: rateLimitWarning ?? "",
          },
          { operationalLicense, facilityName },
        );
        nextMetrc = applyMetrcSuccessStatus(nextMetrc, {
          httpStatus: result.status,
          message: formatMetrcSuccessMessage({
            kind: "locations_sync",
            count: totalLocationsSynced,
          }),
          checkedAt: syncedAtIso,
          totalLocationsSynced,
        });

        await this.configService.upsert({
          companyId: input.companyId,
          actorUserId: input.actorUserId,
          key: "company",
          value: { ...loaded.company, metrc: nextMetrc },
        });

        const autoMappedCount = await applyAutoRoomMappingsForCompany({
          companyId: input.companyId,
          nexbatchRooms,
        });

        const persisted = await listMetrcLocationsForCompany(input.companyId);
        const locations = persisted.map((row) => dbRowToDto(row, nexbatchRooms));

        const endpointKey = metrcEndpointPathKey(pathname);

        logInfo("[METRC] locations_sync_success", {
          companyId: input.companyId,
          endpoint: endpointKey,
          status: result.status,
          count: totalLocationsSynced,
          autoMappedCount,
          durationMs: result.durationMs,
          retries: result.retries,
        });

        return {
          ok: true,
          syncedAt: syncedAtIso,
          count: totalLocationsSynced,
          totalLocationsSynced,
          lastLocationsSync: syncedAtIso,
          locations,
          durationMs: result.durationMs,
          retries: result.retries,
          rateLimitWarning,
          endpoint: endpointKey,
          nexbatchRooms,
          autoMappedCount,
        };
      }

      lastStatus = result.status || 502;
      lastMessage = metrcPullFailureMessage(lastStatus, result.metrcMessage || result.message);
      lastEndpoint = result.endpoint ?? pathname.split("?")[0];

      if (
        shouldTryNextMetrcEndpoint("rooms", i, candidates.length, {
          status: result.status,
          upstreamType: result.upstreamError?.type,
        })
      ) {
        continue;
      }
      break;
    }

    if (lastStatus === 401 || lastStatus === 403) {
      logMetrcCredentialDiagnostics({
        companyId: input.companyId,
        purpose: "locations_sync",
        userKeyLength: loaded.userApiKey.length,
        vendorKeyLength: loaded.vendorApiKey.length,
        licensePresent: Boolean(loaded.licenseNumber),
      });
    }

    const credentialHint = buildMetrcCredentialHintFromLoaded(loaded);
    logWarn("[METRC] locations_sync_failed", {
      companyId: input.companyId,
      status: lastStatus,
      endpoint: lastEndpoint ?? null,
    });

    return {
      ok: false,
      status: lastStatus,
      message:
        lastStatus === 401 || lastStatus === 403
          ? `${lastMessage} ${credentialHint}`.trim().slice(0, 4000)
          : lastMessage,
      credentialHint: lastStatus === 401 || lastStatus === 403 ? credentialHint : undefined,
      endpoint: lastEndpoint,
    };
  }

  async listSyncedLocations(companyId: string): Promise<MetrcLocationDto[]> {
    const nexbatchRooms = await this.loadNexbatchRoomOptions(companyId);
    const rows = await listMetrcLocationsForCompany(companyId);
    return rows.map((row) => dbRowToDto(row, nexbatchRooms));
  }

  async updateLocationMapping(input: {
    companyId: string;
    actorUserId: string;
    metrcLocationId: string;
    nexbatchRoomSuite: NexbatchRoomSuite | null;
    nexbatchRoomId: string | null;
  }): Promise<{ ok: true; location: MetrcLocationDto } | { ok: false; status: number; message: string }> {
    const metrcLocationId = String(input.metrcLocationId || "").trim();
    if (!metrcLocationId) {
      return { ok: false, status: 400, message: "METRC location id is required." };
    }

    const suite = input.nexbatchRoomSuite;
    const roomId = input.nexbatchRoomId ? String(input.nexbatchRoomId).trim() : null;

    const parsedSuite = parseNexbatchSuite(suite);

    if (roomId && !parsedSuite) {
      return {
        ok: false,
        status: 400,
        message: "Invalid NexBatch room suite.",
      };
    }

    if (parsedSuite && roomId) {
      const options = await this.loadNexbatchRoomOptions(input.companyId);
      const match = findNexbatchRoomOption(options, parsedSuite, roomId);
      if (!match) {
        return {
          ok: false,
          status: 400,
          message: "Selected NexBatch room was not found in company cultivation config.",
        };
      }
    }

    if ((parsedSuite && !roomId) || (!parsedSuite && roomId)) {
      return {
        ok: false,
        status: 400,
        message: "Provide both NexBatch room suite and room id, or clear both to unmap.",
      };
    }

    try {
      const updated = await updateMetrcLocationMapping({
        companyId: input.companyId,
        metrcLocationId,
        nexbatchRoomSuite: parsedSuite,
        nexbatchRoomId: roomId,
        nexbatchMappingManual: true,
      });
      const nexbatchRooms = await this.loadNexbatchRoomOptions(input.companyId);
      return { ok: true, location: dbRowToDto(updated, nexbatchRooms) };
    } catch {
      return {
        ok: false,
        status: 404,
        message: "METRC location not found. Sync locations before mapping.",
      };
    }
  }
}

export async function syncMetrcLocations(input: {
  companyId: string;
  actorUserId: string;
}): Promise<MetrcLocationsSyncResponse> {
  return new MetrcLocationsSyncService().syncMetrcLocations(input);
}
