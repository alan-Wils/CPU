import { ConfigService } from "./configService.js";
import { logInfo, logWarn } from "../lib/logger.js";
import { MetrcClient, isMetrcClientFailure } from "../lib/metrcClient.js";
import { loadCompanyMetrcConfig } from "../lib/metrcConfigLoader.js";
import {
  buildMetrcCredentialHintFromLoaded,
  logMetrcCredentialDiagnostics,
} from "../lib/metrcCredentialDiagnostics.js";
import {
  buildMetrcEndpointCandidates,
  cacheMetrcEndpointPath,
  metrcEndpointPathKey,
  metrcPullFailureMessage,
  shouldTryNextMetrcEndpoint,
} from "../lib/metrcEndpoints.js";
import {
  parseMetrcFacilitiesPayload,
  pickMetrcFacilityNameFromFacilities,
  pickPrimaryMetrcOperationalLicense,
  resolveMetrcFacilityTypeNameFromPayload,
  type ParsedMetrcFacility,
} from "../lib/metrcFacilitiesParse.js";
import { applyMetrcOperationalSuccess } from "../lib/metrcOperationalStatus.js";
import {
  applyMetrcSuccessStatus,
  formatMetrcSuccessMessage,
} from "../lib/metrcStatusPersistence.js";
import type { MetrcEnvironment } from "../lib/metrcResolveBaseUrl.js";
import {
  listMetrcFacilitiesForCompany,
  upsertMetrcFacilitiesForCompany,
} from "../repositories/metrcFacilityRepository.js";

export type MetrcFacilityDto = {
  licenseNumber: string;
  facilityName: string;
  facilityType: string;
  facilityTypeName: string;
  stateCode: string;
  active: boolean;
  capabilities: Record<string, unknown>;
};

export type MetrcFacilitiesSyncSuccess = {
  ok: true;
  syncedAt: string;
  count: number;
  facilities: MetrcFacilityDto[];
  durationMs: number;
  retries: number;
  rateLimitWarning: string | null;
  endpoint: string;
};

export type MetrcFacilitiesSyncFailure = {
  ok: false;
  status: number;
  message: string;
  credentialHint?: string;
  endpoint?: string;
};

export type MetrcFacilitiesSyncResponse = MetrcFacilitiesSyncSuccess | MetrcFacilitiesSyncFailure;

function toFacilityDto(row: ParsedMetrcFacility): MetrcFacilityDto {
  return {
    licenseNumber: row.licenseNumber,
    facilityName: row.facilityName,
    facilityType: row.facilityTypeName || row.facilityType,
    facilityTypeName: row.facilityTypeName,
    stateCode: row.stateCode,
    active: row.active,
    capabilities: row.capabilities,
  };
}

export class MetrcFacilitiesSyncService {
  configService = new ConfigService();

  async syncMetrcFacilities(input: {
    companyId: string;
    actorUserId: string;
  }): Promise<MetrcFacilitiesSyncResponse> {
    logInfo("[METRC] facilities_sync_start", { companyId: input.companyId });

    const loaded = await loadCompanyMetrcConfig(input.companyId);
    if (!loaded) {
      logWarn("[METRC] facilities_sync_failed", {
        companyId: input.companyId,
        status: 404,
        reason: "company_config_missing",
      });
      return {
        ok: false,
        status: 404,
        message: "Company configuration not found.",
      };
    }

    if (!loaded.userApiKey) {
      logWarn("[METRC] facilities_sync_failed", {
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

    const client = MetrcClient.fromLoadedConfig(loaded, input.companyId);
    const endpointCtx = {
      stateCode: loaded.stateCode || "CO",
      environment: loaded.environment as MetrcEnvironment,
    };
    const candidates = buildMetrcEndpointCandidates("facilities", "");

    let lastStatus = 502;
    let lastMessage = "METRC facilities sync failed.";
    let lastEndpoint: string | undefined;

    for (let i = 0; i < candidates.length; i += 1) {
      const pathname = candidates[i]!;
      const result = await client.get<unknown>(pathname);

      if (!isMetrcClientFailure(result)) {
        cacheMetrcEndpointPath(endpointCtx, "facilities", pathname);
        const parsed = parseMetrcFacilitiesPayload(result.data, loaded.stateCode || "CO");
        const syncedAt = new Date();
        const syncedAtIso = syncedAt.toISOString();
        const rateLimitWarning =
          result.rateLimitWaitedMs > 0
            ? `Rate limiter delayed this request by ${result.rateLimitWaitedMs}ms.`
            : result.retries > 0
              ? `Completed after ${result.retries} retries.`
              : null;

        await upsertMetrcFacilitiesForCompany(
          input.companyId,
          parsed.map((row) => ({
            licenseNumber: row.licenseNumber,
            facilityName: row.facilityName,
            facilityType: row.facilityTypeName || row.facilityType,
            facilityTypeName: row.facilityTypeName,
            stateCode: row.stateCode,
            active: row.active,
            capabilitiesJson: JSON.stringify(row.capabilities),
            rawPayloadJson: JSON.stringify(row.raw),
            lastSyncedAt: syncedAt,
          })),
        );

        const operationalLicense =
          pickPrimaryMetrcOperationalLicense(parsed) ?? loaded.licenseNumber;
        const facilityName =
          pickMetrcFacilityNameFromFacilities(parsed, loaded.licenseNumber) ?? null;

        let nextMetrc = applyMetrcOperationalSuccess(
          {
            ...loaded.metrc,
            metrcSandboxLastFacilitiesSyncAt: syncedAtIso,
            metrcSandboxLastFacilitiesCount: parsed.length,
            metrcSandboxLastRateLimitWarning: rateLimitWarning ?? "",
          },
          { operationalLicense, facilityName },
        );
        nextMetrc = applyMetrcSuccessStatus(nextMetrc, {
          httpStatus: result.status,
          message: formatMetrcSuccessMessage({ kind: "facilities_sync", count: parsed.length }),
          checkedAt: syncedAtIso,
          totalFacilitiesSynced: parsed.length,
        });

        await this.configService.upsert({
          companyId: input.companyId,
          actorUserId: input.actorUserId,
          key: "company",
          value: { ...loaded.company, metrc: nextMetrc },
        });

        const endpointKey = metrcEndpointPathKey(pathname);
        const facilities = parsed.map(toFacilityDto);

        logInfo("[METRC] facilities_sync_success", {
          companyId: input.companyId,
          endpoint: endpointKey,
          status: result.status,
          count: parsed.length,
          durationMs: result.durationMs,
          retries: result.retries,
        });

        return {
          ok: true,
          syncedAt: syncedAtIso,
          count: parsed.length,
          facilities,
          durationMs: result.durationMs,
          retries: result.retries,
          rateLimitWarning,
          endpoint: endpointKey,
        };
      }

      lastStatus = result.status || 502;
      lastMessage = metrcPullFailureMessage(lastStatus, result.metrcMessage || result.message);
      lastEndpoint = result.endpoint ?? pathname.split("?")[0];

      if (
        shouldTryNextMetrcEndpoint("facilities", i, candidates.length, {
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
        purpose: "facilities_sync",
        userKeyLength: loaded.userApiKey.length,
        vendorKeyLength: loaded.vendorApiKey.length,
        licensePresent: Boolean(loaded.licenseNumber),
      });
    }

    const credentialHint = buildMetrcCredentialHintFromLoaded(loaded);
    logWarn("[METRC] facilities_sync_failed", {
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

  async listSyncedFacilities(companyId: string): Promise<MetrcFacilityDto[]> {
    const rows = await listMetrcFacilitiesForCompany(companyId);
    return rows.map((row) => {
      const storedType = String(row.facilityTypeName || row.facilityType || "").trim();
      const facilityTypeName =
        storedType && storedType !== "[object Object]"
          ? storedType
          : resolveMetrcFacilityTypeNameFromPayload(row.rawPayloadJson);
      return {
        licenseNumber: row.licenseNumber,
        facilityName: row.facilityName,
        facilityType: facilityTypeName,
        facilityTypeName,
        stateCode: row.stateCode,
        active: row.active,
        capabilities: safeParseJsonObject(row.capabilitiesJson),
      };
    });
  }
}

function safeParseJsonObject(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function syncMetrcFacilities(input: {
  companyId: string;
  actorUserId: string;
}): Promise<MetrcFacilitiesSyncResponse> {
  return new MetrcFacilitiesSyncService().syncMetrcFacilities(input);
}
