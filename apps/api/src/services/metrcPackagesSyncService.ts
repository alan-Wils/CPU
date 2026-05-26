import { ConfigService } from "./configService.js";
import { LeafLinkInventoryService } from "./leaflinkService.js";
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
  buildMetrcPackageInventoryReconciliation,
  collectNexbatchInventoryPackageRefs,
  type MetrcPackageInventoryReconciliationRow,
  type MetrcPackageReconciliationSummary,
} from "../lib/metrcPackageInventoryReconciliation.js";
import { parseMetrcPackagesPayload } from "../lib/metrcPackagesParse.js";
import {
  applyMetrcOperationalSuccess,
  isMetrcSandboxPlaceholderLicense,
} from "../lib/metrcOperationalStatus.js";
import {
  applyMetrcSuccessStatus,
  formatMetrcSuccessMessage,
} from "../lib/metrcStatusPersistence.js";
import type { MetrcEnvironment } from "../lib/metrcResolveBaseUrl.js";
import { prisma } from "../config/prisma.js";
import {
  listMetrcPackagesForCompany,
  upsertMetrcPackagesForCompany,
} from "../repositories/metrcPackageRepository.js";

export type MetrcPackageDto = {
  packageLabel: string;
  itemName: string;
  quantity: number;
  unitOfMeasure: string;
  location: string;
  productionBatchNumber: string;
  sourceHarvestNames: string;
  packagedDate: string | null;
  expirationDate: string | null;
  strainName: string;
  licenseNumber: string;
  lastSyncedAt: string;
};

export type MetrcPackagesSyncSuccess = {
  ok: true;
  syncedAt: string;
  count: number;
  totalPackagesSynced: number;
  lastPackagesSync: string;
  packages: MetrcPackageDto[];
  durationMs: number;
  retries: number;
  rateLimitWarning: string | null;
  endpoint: string;
};

export type MetrcPackagesSyncFailure = {
  ok: false;
  status: number;
  message: string;
  credentialHint?: string;
  endpoint?: string;
};

export type MetrcPackagesSyncResponse = MetrcPackagesSyncSuccess | MetrcPackagesSyncFailure;

export type MetrcPackagesReconciliationResponse = {
  ok: true;
  rows: MetrcPackageInventoryReconciliationRow[];
  summary: MetrcPackageReconciliationSummary;
};

function dbRowToDto(row: Awaited<ReturnType<typeof listMetrcPackagesForCompany>>[number]): MetrcPackageDto {
  return {
    packageLabel: row.packageLabel,
    itemName: row.itemName,
    quantity: row.quantity,
    unitOfMeasure: row.unitOfMeasure,
    location: row.location,
    productionBatchNumber: row.productionBatchNumber,
    sourceHarvestNames: row.sourceHarvestNames,
    packagedDate: row.packagedDate ? row.packagedDate.toISOString() : null,
    expirationDate: row.expirationDate ? row.expirationDate.toISOString() : null,
    strainName: row.strainName,
    licenseNumber: row.licenseNumber,
    lastSyncedAt: row.lastSyncedAt.toISOString(),
  };
}

export class MetrcPackagesSyncService {
  configService = new ConfigService();
  leafLinkInventoryService = new LeafLinkInventoryService();

  async listSyncedPackages(companyId: string): Promise<MetrcPackageDto[]> {
    const rows = await listMetrcPackagesForCompany(companyId);
    return rows.map(dbRowToDto);
  }

  async buildInventoryReconciliation(
    companyId: string,
  ): Promise<MetrcPackagesReconciliationResponse> {
    const metrcPackages = await listMetrcPackagesForCompany(companyId);
    const leafLinkSnap = await this.leafLinkInventoryService.readPersistedInventory(companyId);
    const cultivationTransfers = await prisma.cultivationExtractionTransfer.findMany({
      where: { companyId, metrcTag: { not: null } },
      select: {
        metrcTag: true,
        displayName: true,
        grams: true,
        storageLocationName: true,
      },
      take: 5000,
    });

    const nexbatchRefs = collectNexbatchInventoryPackageRefs({
      leafLinkItems: leafLinkSnap?.items ?? [],
      cultivationTransfers,
    });

    return {
      ok: true,
      ...buildMetrcPackageInventoryReconciliation({
        metrcPackages: metrcPackages.map((row) => ({
          packageLabel: row.packageLabel,
          itemName: row.itemName,
          quantity: row.quantity,
          unitOfMeasure: row.unitOfMeasure,
          location: row.location,
          strainName: row.strainName,
        })),
        nexbatchRefs,
      }),
    };
  }

  async syncMetrcPackages(input: {
    companyId: string;
    actorUserId: string;
  }): Promise<MetrcPackagesSyncResponse> {
    logInfo("[METRC] packages_sync_start", { companyId: input.companyId });

    const loaded = await loadCompanyMetrcConfig(input.companyId);
    if (!loaded) {
      logWarn("[METRC] packages_sync_failed", {
        companyId: input.companyId,
        status: 404,
        reason: "company_config_missing",
      });
      return { ok: false, status: 404, message: "Company configuration not found." };
    }

    if (!loaded.userApiKey) {
      logWarn("[METRC] packages_sync_failed", {
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
      logWarn("[METRC] packages_sync_failed", {
        companyId: input.companyId,
        status: 400,
        reason: "license_missing",
      });
      return {
        ok: false,
        status: 400,
        message: "Facility license number is required for METRC packages sync.",
      };
    }

    const client = MetrcClient.fromLoadedConfig(loaded, input.companyId);
    const endpointCtx = {
      stateCode: loaded.stateCode || "CO",
      environment: loaded.environment as MetrcEnvironment,
    };

    let operationalLicense = license;
    let candidates = orderMetrcEndpointCandidates(endpointCtx, "packages", license);

    if (isMetrcSandboxPlaceholderLicense(license)) {
      const locationsRequest = await resolveMetrcLocationsActiveRequest({
        client,
        loaded,
        companyId: input.companyId,
        purpose: "packages_sync",
      });
      operationalLicense = locationsRequest.params.licenseNumber;
      license = operationalLicense;
      candidates = orderMetrcEndpointCandidates(endpointCtx, "packages", license);
    }

    let lastStatus = 502;
    let lastMessage = "METRC packages sync failed.";
    let lastEndpoint: string | undefined;

    for (let i = 0; i < candidates.length; i += 1) {
      const pathname = candidates[i]!;
      const result = await client.get<unknown>(pathname);

      if (!isMetrcClientFailure(result)) {
        cacheMetrcEndpointPath(endpointCtx, "packages", pathname);
        const parsed = parseMetrcPackagesPayload(result.data);
        const syncedAt = new Date();
        const syncedAtIso = syncedAt.toISOString();
        const rateLimitWarning =
          result.rateLimitWaitedMs > 0
            ? `Rate limiter delayed this request by ${result.rateLimitWaitedMs}ms.`
            : result.retries > 0
              ? `Completed after ${result.retries} retries.`
              : null;

        await upsertMetrcPackagesForCompany(
          input.companyId,
          parsed.map((row) => ({
            packageLabel: row.packageLabel,
            licenseNumber: operationalLicense,
            itemName: row.itemName,
            quantity: row.quantity,
            unitOfMeasure: row.unitOfMeasure,
            location: row.location,
            productionBatchNumber: row.productionBatchNumber,
            sourceHarvestNames: row.sourceHarvestNames,
            packagedDate: row.packagedDate,
            expirationDate: row.expirationDate,
            strainName: row.strainName,
            rawPayloadJson: JSON.stringify(row.raw),
            lastSyncedAt: syncedAt,
          })),
        );

        const totalPackagesSynced = parsed.length;

        let nextMetrc = applyMetrcOperationalSuccess(
          {
            ...loaded.metrc,
            metrcSandboxLastPackagesSyncAt: syncedAtIso,
            metrcLastPackagesSyncAt: syncedAtIso,
            lastPackagesSync: syncedAtIso,
            metrcSandboxLastPackagesCount: totalPackagesSynced,
            metrcSandboxLastRateLimitWarning: rateLimitWarning ?? "",
          },
          { operationalLicense, facilityName: null },
        );
        nextMetrc = applyMetrcSuccessStatus(nextMetrc, {
          httpStatus: result.status,
          message: formatMetrcSuccessMessage({ kind: "packages_sync", count: totalPackagesSynced }),
          checkedAt: syncedAtIso,
          totalPackagesSynced,
        });

        await this.configService.upsert({
          companyId: input.companyId,
          actorUserId: input.actorUserId,
          key: "company",
          value: { ...loaded.company, metrc: nextMetrc },
        });

        const persisted = await listMetrcPackagesForCompany(input.companyId);
        const packages = persisted.map(dbRowToDto);
        const endpointKey = metrcEndpointPathKey(pathname);

        logInfo("[METRC] packages_sync_success", {
          companyId: input.companyId,
          endpoint: endpointKey,
          status: result.status,
          count: totalPackagesSynced,
          durationMs: result.durationMs,
          retries: result.retries,
        });

        return {
          ok: true,
          syncedAt: syncedAtIso,
          count: totalPackagesSynced,
          totalPackagesSynced,
          lastPackagesSync: syncedAtIso,
          packages,
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
        shouldTryNextMetrcEndpoint("packages", i, candidates.length, {
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
        purpose: "packages_sync",
        userKeyLength: loaded.userApiKey.length,
        vendorKeyLength: loaded.vendorApiKey.length,
        licensePresent: Boolean(loaded.licenseNumber),
      });
    }

    logWarn("[METRC] packages_sync_failed", {
      companyId: input.companyId,
      status: lastStatus,
      endpoint: lastEndpoint,
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
      endpoint: lastEndpoint,
    };
  }
}
