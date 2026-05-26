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
  metrcPullFailureMessage,
  orderMetrcEndpointCandidates,
  shouldTryNextMetrcEndpoint,
} from "../lib/metrcEndpoints.js";
import { parseMetrcItemsPayload } from "../lib/metrcItemsParse.js";
import { resolveMetrcLocationsActiveRequest } from "../lib/metrcLocationsActiveQuery.js";
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
  listMetrcItemsForCompany,
  upsertMetrcItemsForCompany,
} from "../repositories/metrcItemRepository.js";

export type MetrcItemDto = {
  metrcItemId: string;
  itemName: string;
  categoryName: string;
  unitOfMeasureName: string;
  quantityType: string;
  licenseNumber: string;
  lastSyncedAt: string;
};

export type MetrcItemsSyncSuccess = {
  ok: true;
  syncedAt: string;
  count: number;
  totalItemsSynced: number;
  lastItemsSync: string;
  items: MetrcItemDto[];
  durationMs: number;
  retries: number;
  rateLimitWarning: string | null;
  endpoint: string;
};

export type MetrcItemsSyncFailure = {
  ok: false;
  status: number;
  message: string;
  credentialHint?: string;
  endpoint?: string;
};

export type MetrcItemsSyncResponse = MetrcItemsSyncSuccess | MetrcItemsSyncFailure;

function dbRowToDto(row: Awaited<ReturnType<typeof listMetrcItemsForCompany>>[number]): MetrcItemDto {
  return {
    metrcItemId: row.metrcItemId,
    itemName: row.itemName,
    categoryName: row.categoryName,
    unitOfMeasureName: row.unitOfMeasureName,
    quantityType: row.quantityType,
    licenseNumber: row.licenseNumber,
    lastSyncedAt: row.lastSyncedAt.toISOString(),
  };
}

export class MetrcItemsSyncService {
  configService = new ConfigService();

  async listSyncedItems(companyId: string): Promise<MetrcItemDto[]> {
    const rows = await listMetrcItemsForCompany(companyId);
    return rows.map(dbRowToDto);
  }

  async syncMetrcItems(input: {
    companyId: string;
    actorUserId: string;
  }): Promise<MetrcItemsSyncResponse> {
    logInfo("[METRC] items_sync_start", { companyId: input.companyId });

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

    let license = String(loaded.licenseNumber || "").trim();
    if (!license) {
      return {
        ok: false,
        status: 400,
        message: "Facility license number is required for METRC items sync.",
      };
    }

    const client = MetrcClient.fromLoadedConfig(loaded, input.companyId);
    const endpointCtx = {
      stateCode: loaded.stateCode || "CO",
      environment: loaded.environment as MetrcEnvironment,
    };

    let operationalLicense = license;
    let candidates = orderMetrcEndpointCandidates(endpointCtx, "items", license);

    if (isMetrcSandboxPlaceholderLicense(license)) {
      const locationsRequest = await resolveMetrcLocationsActiveRequest({
        client,
        loaded,
        companyId: input.companyId,
        purpose: "items_sync",
      });
      operationalLicense = locationsRequest.params.licenseNumber;
      license = operationalLicense;
      candidates = orderMetrcEndpointCandidates(endpointCtx, "items", license);
    }

    const startedAt = Date.now();
    let retries = 0;
    let lastStatus = 502;
    let lastMessage = "METRC items sync failed.";
    let lastEndpoint: string | undefined;

    for (let i = 0; i < candidates.length; i += 1) {
      const pathname = candidates[i]!;
      const result = await client.get<unknown>(pathname);
      lastEndpoint = pathname.split("?")[0];

      if (!isMetrcClientFailure(result)) {
        cacheMetrcEndpointPath(endpointCtx, "items", pathname);
        const parsed = parseMetrcItemsPayload(result.data);
        const syncedAt = new Date();
        const syncedAtIso = syncedAt.toISOString();
        const rateLimitWarning =
          result.rateLimitWaitedMs > 0
            ? `Rate limiter delayed this request by ${result.rateLimitWaitedMs}ms.`
            : result.retries > 0
              ? `Completed after ${result.retries} retries.`
              : null;

        if (parsed.length > 0) {
          await upsertMetrcItemsForCompany(
            input.companyId,
            parsed.map((row) => ({
              metrcItemId: row.metrcItemId,
              licenseNumber: operationalLicense,
              itemName: row.itemName,
              categoryName: row.categoryName,
              unitOfMeasureName: row.unitOfMeasureName,
              quantityType: row.quantityType,
              rawPayloadJson: JSON.stringify(row.raw),
              lastSyncedAt: syncedAt,
            })),
          );
        }

        const totalItemsSynced = parsed.length;
        const items = (await listMetrcItemsForCompany(input.companyId)).map(dbRowToDto);
        const durationMs = Date.now() - startedAt;

        let nextMetrc = applyMetrcOperationalSuccess(
          {
            ...loaded.metrc,
            metrcSandboxLastItemsSyncAt: syncedAtIso,
            metrcSandboxLastItemsCount: totalItemsSynced,
            metrcSandboxLastRateLimitWarning: rateLimitWarning ?? "",
          },
          { operationalLicense, facilityName: null },
        );
        nextMetrc = applyMetrcSuccessStatus(nextMetrc, {
          httpStatus: result.status,
          message: formatMetrcSuccessMessage({ kind: "items_sync", count: totalItemsSynced }),
          checkedAt: syncedAtIso,
          totalItemsSynced,
        });

        await this.configService.upsert({
          companyId: input.companyId,
          actorUserId: input.actorUserId,
          key: "company",
          value: { ...loaded.company, metrc: nextMetrc },
        });

        logInfo("[METRC] items_sync_success", {
          companyId: input.companyId,
          count: items.length,
          endpoint: lastEndpoint,
          durationMs,
        });

        return {
          ok: true,
          syncedAt: syncedAtIso,
          count: parsed.length,
          totalItemsSynced: items.length,
          lastItemsSync: syncedAtIso,
          items,
          durationMs,
          retries: result.retries,
          rateLimitWarning,
          endpoint: lastEndpoint,
        };
      }

      lastStatus = result.status || 502;
      lastMessage = metrcPullFailureMessage(lastStatus, result.metrcMessage || result.message);
      lastEndpoint = result.endpoint ?? pathname.split("?")[0];
      retries = result.retries;
      logWarn("[METRC] items_sync_attempt_failed", {
        companyId: input.companyId,
        endpoint: lastEndpoint,
        status: lastStatus,
        message: lastMessage,
      });

      if (
        shouldTryNextMetrcEndpoint("items", i, candidates.length, {
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
        purpose: "items_sync",
        userKeyLength: loaded.userApiKey.length,
        vendorKeyLength: loaded.vendorApiKey.length,
        licensePresent: Boolean(loaded.licenseNumber),
      });
    }

    const credentialHint = buildMetrcCredentialHintFromLoaded(loaded);
    return {
      ok: false,
      status: lastStatus,
      message: lastMessage,
      credentialHint,
      endpoint: lastEndpoint,
    };
  }
}
