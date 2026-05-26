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
import {
  findNexbatchStrainLabel,
  parseNexbatchStrainsFromCultivationValue,
  reconcileMetrcStrainsWithNexbatch,
} from "../lib/metrcNexbatchStrains.js";
import {
  applyMetrcOperationalSuccess,
  isMetrcSandboxPlaceholderLicense,
} from "../lib/metrcOperationalStatus.js";
import {
  applyMetrcSuccessStatus,
  formatMetrcSuccessMessage,
} from "../lib/metrcStatusPersistence.js";
import { parseMetrcStrainsPayload } from "../lib/metrcStrainsParse.js";
import type { MetrcEnvironment } from "../lib/metrcResolveBaseUrl.js";
import {
  listMetrcStrainsForCompany,
  upsertMetrcStrainsForCompany,
} from "../repositories/metrcStrainRepository.js";

export type MetrcStrainDto = {
  metrcStrainId: string;
  name: string;
  testingStatus: string;
  active: boolean;
  archived: boolean;
  lastModified: string | null;
  licenseNumber: string;
  nexbatchStrainId: string | null;
  nexbatchStrainLabel: string | null;
};

export type MetrcStrainsSyncSuccess = {
  ok: true;
  syncedAt: string;
  count: number;
  totalStrainsSynced: number;
  lastStrainsSync: string;
  nexbatchStrainsCreated: number;
  strains: MetrcStrainDto[];
  durationMs: number;
  retries: number;
  rateLimitWarning: string | null;
  endpoint: string;
};

export type MetrcStrainsSyncFailure = {
  ok: false;
  status: number;
  message: string;
  credentialHint?: string;
  endpoint?: string;
};

export type MetrcStrainsSyncResponse = MetrcStrainsSyncSuccess | MetrcStrainsSyncFailure;

function toStrainDto(
  row: {
    metrcStrainId: string;
    licenseNumber: string;
    name: string;
    testingStatus: string;
    active: boolean;
    archived: boolean;
    lastModified: Date | null;
    nexbatchStrainId: string | null;
  },
  nexbatchStrains: ReturnType<typeof parseNexbatchStrainsFromCultivationValue>,
): MetrcStrainDto {
  return {
    metrcStrainId: row.metrcStrainId,
    name: row.name,
    testingStatus: row.testingStatus,
    active: row.active,
    archived: row.archived,
    lastModified: row.lastModified ? row.lastModified.toISOString() : null,
    licenseNumber: row.licenseNumber,
    nexbatchStrainId: row.nexbatchStrainId,
    nexbatchStrainLabel: findNexbatchStrainLabel(nexbatchStrains, row.nexbatchStrainId),
  };
}

export class MetrcStrainsSyncService {
  configService = new ConfigService();

  async loadCultivationConfig(companyId: string): Promise<Record<string, unknown>> {
    const rows = await this.configService.list(companyId);
    const cultRow = rows.find((r) => r.key === "cultivation");
    if (!cultRow?.value || typeof cultRow.value !== "object" || Array.isArray(cultRow.value)) {
      return {};
    }
    return cultRow.value as Record<string, unknown>;
  }

  async syncMetrcStrains(input: {
    companyId: string;
    actorUserId: string;
  }): Promise<MetrcStrainsSyncResponse> {
    logInfo("[METRC] strains_sync_start", { companyId: input.companyId });

    const loaded = await loadCompanyMetrcConfig(input.companyId);
    if (!loaded) {
      logWarn("[METRC] strains_sync_failed", {
        companyId: input.companyId,
        status: 404,
        reason: "company_config_missing",
      });
      return { ok: false, status: 404, message: "Company configuration not found." };
    }

    if (!loaded.userApiKey) {
      logWarn("[METRC] strains_sync_failed", {
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

    let license = loaded.licenseNumber;
    if (!license) {
      logWarn("[METRC] strains_sync_failed", {
        companyId: input.companyId,
        status: 400,
        reason: "license_missing",
      });
      return {
        ok: false,
        status: 400,
        message: "Facility license number is required for METRC strains sync.",
      };
    }

    const client = MetrcClient.fromLoadedConfig(loaded, input.companyId);
    const endpointCtx = {
      stateCode: loaded.stateCode || "CO",
      environment: loaded.environment as MetrcEnvironment,
    };

    let operationalLicense = license;
    let candidates = orderMetrcEndpointCandidates(endpointCtx, "strains", license);

    if (isMetrcSandboxPlaceholderLicense(license)) {
      const locationsRequest = await resolveMetrcLocationsActiveRequest({
        client,
        loaded,
        companyId: input.companyId,
        purpose: "strains_sync",
      });
      operationalLicense = locationsRequest.params.licenseNumber;
      license = operationalLicense;
      candidates = orderMetrcEndpointCandidates(endpointCtx, "strains", license);
    }

    let lastStatus = 502;
    let lastMessage = "METRC strains sync failed.";
    let lastEndpoint: string | undefined;

    for (let i = 0; i < candidates.length; i += 1) {
      const pathname = candidates[i]!;
      const result = await client.get<unknown>(pathname);

      if (!isMetrcClientFailure(result)) {
        cacheMetrcEndpointPath(endpointCtx, "strains", pathname);
        const parsed = parseMetrcStrainsPayload(result.data);
        const syncedAt = new Date();
        const syncedAtIso = syncedAt.toISOString();
        const rateLimitWarning =
          result.rateLimitWaitedMs > 0
            ? `Rate limiter delayed this request by ${result.rateLimitWaitedMs}ms.`
            : result.retries > 0
              ? `Completed after ${result.retries} retries.`
              : null;

        const cultivationBefore = await this.loadCultivationConfig(input.companyId);
        const reconciled = reconcileMetrcStrainsWithNexbatch({
          cultivation: cultivationBefore,
          metrcStrains: parsed.map((row) => ({
            metrcStrainId: row.metrcStrainId,
            name: row.name,
          })),
        });

        if (reconciled.changed) {
          await this.configService.upsert({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            key: "cultivation",
            value: reconciled.cultivation,
          });
        }

        const nexbatchStrains = parseNexbatchStrainsFromCultivationValue(reconciled.cultivation);

        await upsertMetrcStrainsForCompany(
          input.companyId,
          parsed.map((row) => ({
            metrcStrainId: row.metrcStrainId,
            licenseNumber: operationalLicense,
            name: row.name,
            testingStatus: row.testingStatus,
            active: row.active,
            archived: row.archived,
            lastModified: row.lastModified,
            rawPayloadJson: JSON.stringify(row.raw),
            nexbatchStrainId: reconciled.links.get(row.metrcStrainId) ?? null,
            lastSyncedAt: syncedAt,
          })),
        );

        const totalStrainsSynced = parsed.length;

        let nextMetrc = applyMetrcOperationalSuccess(
          {
            ...loaded.metrc,
            metrcSandboxLastStrainsSyncAt: syncedAtIso,
            metrcLastStrainsSyncAt: syncedAtIso,
            lastStrainsSync: syncedAtIso,
            metrcSandboxLastStrainsCount: totalStrainsSynced,
            metrcSandboxLastRateLimitWarning: rateLimitWarning ?? "",
          },
          { operationalLicense, facilityName: null },
        );
        nextMetrc = applyMetrcSuccessStatus(nextMetrc, {
          httpStatus: result.status,
          message: formatMetrcSuccessMessage({ kind: "strains_sync", count: totalStrainsSynced }),
          checkedAt: syncedAtIso,
          totalStrainsSynced,
        });

        await this.configService.upsert({
          companyId: input.companyId,
          actorUserId: input.actorUserId,
          key: "company",
          value: { ...loaded.company, metrc: nextMetrc },
        });

        const persisted = await listMetrcStrainsForCompany(input.companyId);
        const strains = persisted.map((row) => toStrainDto(row, nexbatchStrains));
        const endpointKey = metrcEndpointPathKey(pathname);

        logInfo("[METRC] strains_sync_success", {
          companyId: input.companyId,
          endpoint: endpointKey,
          status: result.status,
          count: totalStrainsSynced,
          nexbatchStrainsCreated: reconciled.nexbatchStrainsCreated,
          durationMs: result.durationMs,
          retries: result.retries,
        });

        return {
          ok: true,
          syncedAt: syncedAtIso,
          count: totalStrainsSynced,
          totalStrainsSynced,
          lastStrainsSync: syncedAtIso,
          nexbatchStrainsCreated: reconciled.nexbatchStrainsCreated,
          strains,
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
        shouldTryNextMetrcEndpoint("strains", i, candidates.length, {
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
        purpose: "strains_sync",
        userKeyLength: loaded.userApiKey.length,
        vendorKeyLength: loaded.vendorApiKey.length,
        licensePresent: Boolean(loaded.licenseNumber),
      });
    }

    const credentialHint = buildMetrcCredentialHintFromLoaded(loaded);
    logWarn("[METRC] strains_sync_failed", {
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

  async listSyncedStrains(companyId: string): Promise<MetrcStrainDto[]> {
    const cultivation = await this.loadCultivationConfig(companyId);
    const nexbatchStrains = parseNexbatchStrainsFromCultivationValue(cultivation);
    const rows = await listMetrcStrainsForCompany(companyId);
    return rows.map((row) => toStrainDto(row, nexbatchStrains));
  }
}

export async function syncMetrcStrains(input: {
  companyId: string;
  actorUserId: string;
}): Promise<MetrcStrainsSyncResponse> {
  return new MetrcStrainsSyncService().syncMetrcStrains(input);
}
