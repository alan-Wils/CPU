import { prisma } from "../config/prisma.js";
import { logInfo, logWarn } from "../lib/logger.js";
import { MetrcClient, isMetrcClientFailure } from "../lib/metrcClient.js";
import { loadCompanyMetrcConfig } from "../lib/metrcConfigLoader.js";
import {
  buildMetrcCredentialHintFromLoaded,
  logMetrcCredentialDiagnostics,
} from "../lib/metrcCredentialDiagnostics.js";
import { metrcPullFailureMessage } from "../lib/metrcEndpoints.js";
import {
  appendMetrcPackageRequestLog,
  findMetrcPackageByLabel,
} from "../repositories/metrcPackageRepository.js";
import { findMetrcItemById, findMetrcItemByName } from "../repositories/metrcItemRepository.js";
import { MetrcPackagesSyncService } from "./metrcPackagesSyncService.js";

export type MetrcCreateTestPackageInput = {
  companyId: string;
  actorUserId: string;
  metrcHarvestId: string;
  metrcItemId?: string | null;
  itemName?: string | null;
  packageTag: string;
  quantity: number;
  unitOfMeasure: string;
  metrcLocationId?: string | null;
  locationName?: string | null;
  packagedDate: string;
  note?: string | null;
};

export type MetrcCreateTestPackageSuccess = {
  ok: true;
  status: number;
  message: string;
  alreadyExists: boolean;
  endpoint: string;
  requestPayload: unknown;
  responsePayload: unknown;
  durationMs: number;
  packageLabel: string;
  packagesSynced: number;
};

export type MetrcCreateTestPackageFailure = {
  ok: false;
  status: number;
  message: string;
  credentialHint?: string;
  endpoint?: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  metrcMessage?: string;
};

export type MetrcCreateTestPackageResponse =
  | MetrcCreateTestPackageSuccess
  | MetrcCreateTestPackageFailure;

function licenseQuery(licenseNumber: string): string {
  const license = String(licenseNumber || "").trim();
  return license ? `?licenseNumber=${encodeURIComponent(license)}` : "";
}

export function buildHarvestPackageCreatePathCandidates(licenseNumber: string): string[] {
  const q = licenseQuery(licenseNumber);
  return [`/harvests/v2/packages${q}`, `/harvests/v1/create/packages${q}`];
}

export function buildMetrcHarvestPackageCreateBody(input: {
  packageTag: string;
  itemName: string;
  quantity: number;
  unitOfMeasure: string;
  locationName: string | null;
  packagedDate: string;
  note: string | null;
  metrcHarvestId: string;
  harvestName: string;
}): unknown[] {
  const harvestIdNum = Number(input.metrcHarvestId);
  const useHarvestId = Number.isFinite(harvestIdNum) && harvestIdNum > 0;

  return [
    {
      Tag: input.packageTag,
      Location: input.locationName || null,
      Sublocation: null,
      Item: input.itemName,
      UnitOfWeight: input.unitOfMeasure,
      PatientLicenseNumber: null,
      Note: input.note,
      IsProductionBatch: false,
      ProductionBatchNumber: null,
      IsTradeSample: false,
      IsDonation: false,
      ProductRequiresRemediation: false,
      RemediateProduct: false,
      RemediationMethodId: null,
      RemediationDate: null,
      RemediationSteps: null,
      ProductRequiresDecontamination: false,
      DecontaminateProduct: false,
      DecontaminationDate: null,
      DecontaminationSteps: null,
      ActualDate: input.packagedDate,
      ExpirationDate: null,
      SellByDate: null,
      UseByDate: null,
      Ingredients: [
        {
          HarvestId: useHarvestId ? harvestIdNum : null,
          HarvestName: useHarvestId ? null : input.harvestName || null,
          Weight: input.quantity,
          UnitOfWeight: input.unitOfMeasure,
        },
      ],
      ProcessingJobTypeId: null,
      LabTestStageId: null,
      RequiredLabTestBatches: [],
    },
  ];
}

async function resolveItemForCreate(
  companyId: string,
  input: MetrcCreateTestPackageInput,
): Promise<{ ok: true; itemName: string } | { ok: false; status: number; message: string }> {
  const explicitId = String(input.metrcItemId || "").trim();
  if (explicitId) {
    const row = await findMetrcItemById(companyId, explicitId);
    if (!row) {
      return {
        ok: false,
        status: 400,
        message: `METRC item id "${explicitId}" was not found. Sync items first.`,
      };
    }
    return { ok: true, itemName: row.itemName.trim() || explicitId };
  }

  const explicitName = String(input.itemName || "").trim();
  if (explicitName) {
    const row = await findMetrcItemByName(companyId, explicitName);
    if (row) return { ok: true, itemName: row.itemName.trim() };
    return { ok: true, itemName: explicitName };
  }

  return {
    ok: false,
    status: 400,
    message: "METRC item is required. Sync items and select an item, or provide itemName.",
  };
}

async function resolveLocationForCreate(input: {
  companyId: string;
  metrcLocationId?: string | null;
  locationName?: string | null;
}): Promise<{ ok: true; locationName: string | null } | { ok: false; status: number; message: string }> {
  const explicitId = String(input.metrcLocationId || "").trim();
  if (explicitId) {
    const row = await prisma.metrcLocation.findFirst({
      where: { companyId: input.companyId, metrcLocationId: explicitId },
    });
    return {
      ok: true,
      locationName: row?.name?.trim() || String(input.locationName || "").trim() || null,
    };
  }

  const explicitName = String(input.locationName || "").trim();
  if (explicitName) {
    return { ok: true, locationName: explicitName };
  }

  return { ok: true, locationName: null };
}

export class MetrcPackageCreateService {
  packagesSyncService = new MetrcPackagesSyncService();

  async createTestPackage(
    input: MetrcCreateTestPackageInput,
  ): Promise<MetrcCreateTestPackageResponse> {
    logInfo("[METRC] package_create_test_start", {
      companyId: input.companyId,
      packageTag: input.packageTag,
      metrcHarvestId: input.metrcHarvestId,
    });

    const loaded = await loadCompanyMetrcConfig(input.companyId);
    if (!loaded) {
      return { ok: false, status: 404, message: "Company configuration not found." };
    }

    if (loaded.environment !== "sandbox") {
      return {
        ok: false,
        status: 403,
        message: "Create Test Package is sandbox-only. Switch METRC environment to sandbox.",
      };
    }

    if (!loaded.userApiKey) {
      return {
        ok: false,
        status: 400,
        message: "User API key is required. Run sandbox setup or save a user key in Company Config.",
      };
    }

    const license = String(loaded.licenseNumber || "").trim();
    if (!license) {
      return {
        ok: false,
        status: 400,
        message: "Facility license number is required for METRC package creation.",
      };
    }

    const packageTag = String(input.packageTag || "").trim();
    if (!packageTag) {
      return { ok: false, status: 400, message: "Package tag / label is required." };
    }

    const metrcHarvestId = String(input.metrcHarvestId || "").trim();
    if (!metrcHarvestId) {
      return { ok: false, status: 400, message: "Source harvest is required." };
    }

    const harvest = await prisma.metrcHarvest.findFirst({
      where: { companyId: input.companyId, metrcHarvestId },
    });
    if (!harvest) {
      return {
        ok: false,
        status: 400,
        message: `Harvest "${metrcHarvestId}" was not found. Sync harvests first.`,
      };
    }

    const quantity = Number(input.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, status: 400, message: "Quantity must be a positive number." };
    }

    const unitOfMeasure = String(input.unitOfMeasure || "").trim();
    if (!unitOfMeasure) {
      return { ok: false, status: 400, message: "Unit of measure is required." };
    }

    const packagedDate = String(input.packagedDate || "").trim();
    if (!packagedDate || !/^\d{4}-\d{2}-\d{2}$/.test(packagedDate)) {
      return {
        ok: false,
        status: 400,
        message: "Packaged date must be YYYY-MM-DD.",
      };
    }

    const duplicate = await findMetrcPackageByLabel(input.companyId, packageTag);
    if (duplicate) {
      return {
        ok: false,
        status: 409,
        message: `Package label "${packageTag}" already exists in NexBatch. Use a different tag or sync packages.`,
        requestPayload: { packageTag },
        responsePayload: { existingPackageLabel: duplicate.packageLabel },
      };
    }

    const item = await resolveItemForCreate(input.companyId, input);
    if (item.ok === false) {
      return { ok: false, status: item.status, message: item.message };
    }

    const location = await resolveLocationForCreate({
      companyId: input.companyId,
      metrcLocationId: input.metrcLocationId,
      locationName: input.locationName,
    });
    if (location.ok === false) {
      return { ok: false, status: location.status, message: location.message };
    }

    const requestBody = buildMetrcHarvestPackageCreateBody({
      packageTag,
      itemName: item.itemName,
      quantity,
      unitOfMeasure,
      locationName: location.locationName,
      packagedDate,
      note: String(input.note ?? "").trim() || null,
      metrcHarvestId,
      harvestName: harvest.harvestName.trim(),
    });

    logMetrcCredentialDiagnostics(input.companyId, loaded);

    const client = MetrcClient.fromLoadedConfig(loaded, input.companyId);
    const candidates = buildHarvestPackageCreatePathCandidates(license);
    const startedAt = Date.now();
    let lastStatus = 502;
    let lastMessage = "METRC package create failed.";
    let lastEndpoint: string | undefined;
    let lastResponse: unknown = null;

    for (const pathname of candidates) {
      const result = await client.post<unknown>(pathname, requestBody);
      lastEndpoint = pathname.split("?")[0];

      if (!isMetrcClientFailure(result)) {
        const durationMs = Date.now() - startedAt;
        const logPayload = {
          companyId: input.companyId,
          action: "create_test",
          method: "POST",
          endpoint: lastEndpoint,
          httpStatus: result.status,
          requestPayload: { pathname, body: requestBody, harvest: { metrcHarvestId, harvestName: harvest.harvestName } },
          responsePayload: result.data,
          durationMs,
          actorUserId: input.actorUserId,
        };
        await appendMetrcPackageRequestLog(logPayload);

        const syncResult = await this.packagesSyncService.syncMetrcPackages({
          companyId: input.companyId,
          actorUserId: input.actorUserId,
        });
        const packagesSynced =
          syncResult.ok === true ? syncResult.totalPackagesSynced ?? syncResult.count : 0;

        logInfo("[METRC] package_create_test_success", {
          companyId: input.companyId,
          endpoint: lastEndpoint,
          status: result.status,
          packageTag,
          packagesSynced,
        });

        return {
          ok: true,
          status: result.status,
          message: "Test package submitted to METRC sandbox and packages re-synced.",
          alreadyExists: false,
          endpoint: lastEndpoint,
          requestPayload: logPayload.requestPayload,
          responsePayload: result.data,
          durationMs,
          packageLabel: packageTag,
          packagesSynced,
        };
      }

      lastStatus = result.status || 502;
      lastMessage = metrcPullFailureMessage(lastStatus, result.metrcMessage || result.message);
      lastResponse = {
        status: result.status,
        message: result.message,
        metrcMessage: result.metrcMessage,
        endpoint: result.endpoint,
        upstreamError: result.upstreamError,
        authAttempts: result.authAttempts,
      };

      logWarn("[METRC] package_create_test_attempt_failed", {
        companyId: input.companyId,
        endpoint: lastEndpoint,
        status: lastStatus,
        message: lastMessage,
      });
    }

    const durationMs = Date.now() - startedAt;
    await appendMetrcPackageRequestLog({
      companyId: input.companyId,
      action: "create_test",
      method: "POST",
      endpoint: lastEndpoint || "/harvests/v2/packages",
      httpStatus: lastStatus,
      requestPayload: { body: requestBody, harvest: { metrcHarvestId } },
      responsePayload: lastResponse,
      durationMs,
      actorUserId: input.actorUserId,
    });

    const credentialHint = buildMetrcCredentialHintFromLoaded(loaded, lastStatus);
    return {
      ok: false,
      status: lastStatus,
      message: lastMessage,
      credentialHint,
      endpoint: lastEndpoint,
      requestPayload: { body: requestBody },
      responsePayload: lastResponse,
      metrcMessage:
        lastResponse && typeof lastResponse === "object" && "metrcMessage" in lastResponse
          ? String((lastResponse as { metrcMessage?: unknown }).metrcMessage ?? "")
          : undefined,
    };
  }
}
