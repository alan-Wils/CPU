import { logInfo, logWarn } from "./logger.js";
import type { MetrcClient } from "./metrcClient.js";
import { fetchMetrcPackageByLabel } from "./metrcPackageDirectLookup.js";
import { buildWideMetrcPackagesActiveDateRange } from "./metrcPackagesActiveQuery.js";
import {
  buildMetrcPackageSyncDiagnostics,
  type MetrcPackageSyncDiagnostics,
} from "./metrcPackageSyncDiagnostics.js";
import {
  findMetrcPackageByLabel,
  upsertMetrcPackagesForCompany,
} from "../repositories/metrcPackageRepository.js";
import type { MetrcPackagesSyncService } from "../services/metrcPackagesSyncService.js";

export type MetrcPackagePostCreateLookupDiagnostics = MetrcPackageSyncDiagnostics & {
  createdTag: string;
  createLicenseNumber: string;
  lookupLicenseNumber: string;
  lookupEndpoint: string | null;
  lookupDateWindow: { lastModifiedStart: string; lastModifiedEnd: string } | null;
  directLookupUsed: boolean;
};

export type MetrcPackagePostCreateLookupResult = {
  found: boolean;
  directLookupUsed: boolean;
  packageLabel: string;
  packageId: string | null;
  diagnostics: MetrcPackagePostCreateLookupDiagnostics;
  warning?: string;
};

function readPackageIdFromCreateResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const root = data as Record<string, unknown>;
  const ids = root.Ids ?? root.ids;
  if (Array.isArray(ids) && ids[0] != null) {
    const s = String(ids[0]).trim();
    if (s) return s;
  }
  const id = root.Id ?? root.id;
  if (id != null) {
    const s = String(id).trim();
    if (s) return s;
  }
  return null;
}

export async function confirmCreatedPackageInNexbatch(input: {
  companyId: string;
  actorUserId: string;
  client: MetrcClient;
  licenseNumber: string;
  packageLabel: string;
  metrcCreateResponse?: unknown;
  packagesSyncService: MetrcPackagesSyncService;
}): Promise<MetrcPackagePostCreateLookupResult> {
  const createdTag = String(input.packageLabel || "").trim();
  const lookupLicenseNumber = String(input.licenseNumber || "").trim();
  const lookupDateWindow = buildWideMetrcPackagesActiveDateRange();
  let lookupEndpoint: string | null = null;
  let directLookupUsed = false;
  let packageId = readPackageIdFromCreateResponse(input.metrcCreateResponse);

  const baseDiagnostics = (): Omit<
    MetrcPackagePostCreateLookupDiagnostics,
    keyof MetrcPackageSyncDiagnostics
  > => ({
    createdTag,
    createLicenseNumber: lookupLicenseNumber,
    lookupLicenseNumber,
    lookupEndpoint,
    lookupDateWindow,
    directLookupUsed,
  });

  const direct = await fetchMetrcPackageByLabel({
    client: input.client,
    packageLabel: createdTag,
    licenseNumber: lookupLicenseNumber,
  });

  if (direct.ok === true) {
    directLookupUsed = true;
    lookupEndpoint = direct.endpoint;
    packageId = packageId ?? direct.packageId;
    const syncedAt = new Date();
    await upsertMetrcPackagesForCompany(input.companyId, [
      {
        packageLabel: direct.parsed.packageLabel,
        licenseNumber: lookupLicenseNumber,
        itemName: direct.parsed.itemName,
        quantity: direct.parsed.quantity,
        unitOfMeasure: direct.parsed.unitOfMeasure,
        location: direct.parsed.location,
        productionBatchNumber: direct.parsed.productionBatchNumber,
        sourceHarvestNames: direct.parsed.sourceHarvestNames,
        packagedDate: direct.parsed.packagedDate,
        expirationDate: direct.parsed.expirationDate,
        strainName: direct.parsed.strainName,
        rawPayloadJson: JSON.stringify(direct.parsed.raw),
        lastSyncedAt: syncedAt,
      },
    ]);

    logInfo("[METRC] package_post_create_direct_lookup_ok", {
      companyId: input.companyId,
      packageLabel: createdTag,
      endpoint: lookupEndpoint,
    });

    return {
      found: true,
      directLookupUsed: true,
      packageLabel: createdTag,
      packageId,
      diagnostics: {
        ...buildMetrcPackageSyncDiagnostics({
          rawMetrcPackageCount: 1,
          parsed: [direct.parsed],
          pagesFetched: 0,
        }),
        ...baseDiagnostics(),
        lookupEndpoint,
        directLookupUsed: true,
      },
    };
  }

  logWarn("[METRC] package_post_create_direct_lookup_miss", {
    companyId: input.companyId,
    packageLabel: createdTag,
    endpointsTried: direct.endpointsTried,
  });

  const syncResult = await input.packagesSyncService.syncMetrcPackages({
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    waitForPackageLabel: createdTag,
    maxWaitMs: 5000,
    activeDateRange: "wide",
    lookupContext: {
      createdTag,
      createLicenseNumber: lookupLicenseNumber,
      lookupLicenseNumber,
    },
  });

  const syncDiagnostics =
    syncResult.ok === true
      ? syncResult.syncDiagnostics
      : buildMetrcPackageSyncDiagnostics({
          rawMetrcPackageCount: 0,
          parsed: [],
          pagesFetched: 0,
        });

  lookupEndpoint = syncResult.ok === true ? syncResult.endpoint : lookupEndpoint;

  const foundInDb = Boolean(await findMetrcPackageByLabel(input.companyId, createdTag));
  const found =
    foundInDb ||
    (syncResult.ok === true &&
      (syncResult.waitForPackageFound === true ||
        syncResult.packages.some((pkg) => pkg.packageLabel === createdTag)));

  if (found) {
    return {
      found: true,
      directLookupUsed: false,
      packageLabel: createdTag,
      packageId,
      diagnostics: {
        ...syncDiagnostics,
        ...baseDiagnostics(),
        directLookupUsed: false,
        lookupEndpoint: syncResult.ok === true ? syncResult.endpoint : null,
      },
    };
  }

  return {
    found: false,
    directLookupUsed: false,
    packageLabel: createdTag,
    packageId,
    warning:
      "Package created in METRC; active sync has not surfaced it yet.",
    diagnostics: {
      ...syncDiagnostics,
      ...baseDiagnostics(),
      directLookupUsed: false,
      lookupEndpoint: syncResult.ok === true ? syncResult.endpoint : null,
    },
  };
}
