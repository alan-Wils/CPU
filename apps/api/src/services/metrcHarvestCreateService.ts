import { prisma } from "../config/prisma.js";
import { logInfo, logWarn } from "../lib/logger.js";
import { MetrcClient, isMetrcClientFailure } from "../lib/metrcClient.js";
import { loadCompanyMetrcConfig } from "../lib/metrcConfigLoader.js";
import {
  buildMetrcCredentialHintFromLoaded,
  logMetrcCredentialDiagnostics,
} from "../lib/metrcCredentialDiagnostics.js";
import { metrcPullFailureMessage } from "../lib/metrcEndpoints.js";
import { resolveMetrcLocationsActiveRequest } from "../lib/metrcLocationsActiveQuery.js";
import { isMetrcSandboxPlaceholderLicense } from "../lib/metrcOperationalStatus.js";
import type { MetrcEnvironment } from "../lib/metrcResolveBaseUrl.js";
import {
  appendMetrcHarvestRequestLog,
  findMetrcHarvestByName,
  upsertMetrcHarvestsForCompany,
} from "../repositories/metrcHarvestRepository.js";
import type { MetrcHarvestDto } from "./metrcHarvestsSyncService.js";
import { MetrcHarvestsSyncService } from "./metrcHarvestsSyncService.js";

export const METRC_DEFAULT_TEST_HARVEST_NAME = "NexBatch Test Harvest";

export const METRC_HARVEST_TYPES = ["Product", "WholePlant"] as const;
export type MetrcHarvestType = (typeof METRC_HARVEST_TYPES)[number];

export type MetrcCreateTestHarvestInput = {
  companyId: string;
  actorUserId: string;
  metrcPlantBatchId: string;
  harvestName: string;
  harvestType?: string | null;
  wetWeight?: number | null;
  unitOfWeight?: string | null;
  actualDate?: string | null;
  plantCount?: number | null;
  notes?: string | null;
};

export type MetrcCreateTestHarvestSuccess = {
  ok: true;
  status: number;
  message: string;
  alreadyExists: boolean;
  endpoint: string;
  requestPayload: unknown;
  responsePayload: unknown;
  durationMs: number;
  metrcHarvestId: string;
  harvest: MetrcHarvestDto;
};

export type MetrcCreateTestHarvestFailure = {
  ok: false;
  status: number;
  message: string;
  credentialHint?: string;
  endpoint?: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  metrcMessage?: string;
};

export type MetrcCreateTestHarvestResponse =
  | MetrcCreateTestHarvestSuccess
  | MetrcCreateTestHarvestFailure;

function licenseQuery(licenseNumber: string): string {
  const license = String(licenseNumber || "").trim();
  return license ? `?licenseNumber=${encodeURIComponent(license)}` : "";
}

function buildCreatePathCandidates(licenseNumber: string): string[] {
  const q = licenseQuery(licenseNumber);
  return [
    `/harvests/v2/create${q}`,
    `/plants/v2/manicure${q}`,
    `/plants/v1/manicureplants${q}`,
  ];
}

function normalizeHarvestType(raw: string | null | undefined): MetrcHarvestType {
  const trimmed = String(raw ?? "").trim();
  if (trimmed.toLowerCase() === "wholeplant") return "WholePlant";
  return "Product";
}

function buildMetrcCreateHarvestBody(input: {
  plantBatchName: string;
  harvestName: string;
  harvestType: MetrcHarvestType;
  locationName: string;
  wetWeight: number;
  unitOfWeight: string;
  actualDate: string;
  plantCount: number;
  notes: string | null;
}): unknown[] {
  return [
    {
      Plant: input.plantBatchName,
      Weight: input.wetWeight,
      UnitOfWeight: input.unitOfWeight,
      DryingLocation: input.locationName || null,
      DryingSublocation: null,
      HarvestName: input.harvestName,
      PatientLicenseNumber: null,
      ActualDate: input.actualDate,
      PlantCount: input.plantCount,
      HarvestType: input.harvestType,
      Note: input.notes,
    },
  ];
}

function extractCreatedHarvestId(response: unknown, harvestName: string): string | null {
  if (!response || typeof response !== "object") return null;
  const data = response as Record<string, unknown>;
  const ids = data.Ids ?? data.ids;
  if (Array.isArray(ids) && ids.length > 0) {
    return String(ids[0] ?? "").trim() || null;
  }
  const id = data.Id ?? data.id;
  if (id !== undefined && id !== null) return String(id).trim() || null;
  return `pending-${harvestName.toLowerCase().replace(/\s+/g, "-")}`;
}

function rowToDto(
  row: NonNullable<Awaited<ReturnType<typeof findMetrcHarvestByName>>>,
): MetrcHarvestDto {
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

export class MetrcHarvestCreateService {
  harvestsSyncService = new MetrcHarvestsSyncService();

  async createTestHarvest(input: MetrcCreateTestHarvestInput): Promise<MetrcCreateTestHarvestResponse> {
    const harvestName = String(input.harvestName || "").trim();
    const metrcPlantBatchId = String(input.metrcPlantBatchId || "").trim();
    const harvestType = normalizeHarvestType(input.harvestType);
    const wetWeight =
      typeof input.wetWeight === "number" && Number.isFinite(input.wetWeight) && input.wetWeight > 0
        ? input.wetWeight
        : 100;
    const unitOfWeight = String(input.unitOfWeight || "Grams").trim() || "Grams";
    const actualDate =
      String(input.actualDate || "").trim() || new Date().toISOString().slice(0, 10);

    logInfo("[METRC] harvest_create_test_start", {
      companyId: input.companyId,
      harvestName,
      metrcPlantBatchId,
    });

    if (!harvestName) {
      return { ok: false, status: 400, message: "Harvest name is required." };
    }
    if (!metrcPlantBatchId) {
      return { ok: false, status: 400, message: "METRC plant batch is required." };
    }

    const loaded = await loadCompanyMetrcConfig(input.companyId);
    if (!loaded) {
      return { ok: false, status: 404, message: "Company configuration not found." };
    }

    if (loaded.environment !== "sandbox") {
      return {
        ok: false,
        status: 403,
        message: "Create Test Harvest is sandbox-only. Switch METRC environment to sandbox.",
      };
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
        message: "Facility license number is required for METRC harvest creation.",
      };
    }

    const existing = await findMetrcHarvestByName(input.companyId, harvestName);
    if (existing) {
      await appendMetrcHarvestRequestLog({
        companyId: input.companyId,
        action: "create_test_dedupe",
        method: "POST",
        endpoint: "harvests/create",
        httpStatus: 200,
        requestPayload: { harvestName, metrcPlantBatchId, skipped: true },
        responsePayload: { alreadyExists: true, metrcHarvestId: existing.metrcHarvestId },
        durationMs: 0,
        actorUserId: input.actorUserId,
      });

      return {
        ok: true,
        status: 200,
        message: `Harvest "${harvestName}" already exists in NexBatch — using existing record.`,
        alreadyExists: true,
        endpoint: "harvests/create",
        requestPayload: { harvestName, metrcPlantBatchId },
        responsePayload: { alreadyExists: true },
        durationMs: 0,
        metrcHarvestId: existing.metrcHarvestId,
        harvest: rowToDto(existing),
      };
    }

    const plantBatch = await prisma.metrcPlantBatch.findFirst({
      where: { companyId: input.companyId, metrcPlantBatchId },
    });
    if (!plantBatch) {
      return {
        ok: false,
        status: 400,
        message: "Plant batch not found in NexBatch. Sync plant batches first.",
      };
    }

    const plantBatchName = plantBatch.name.trim();
    const locationName = plantBatch.locationName.trim() || plantBatch.metrcLocationId;
    const plantCount =
      typeof input.plantCount === "number" && input.plantCount > 0
        ? Math.min(Math.floor(input.plantCount), Math.max(1, Math.floor(plantBatch.count)))
        : Math.max(1, Math.min(5, Math.floor(plantBatch.count) || 1));

    const client = MetrcClient.fromLoadedConfig(loaded, input.companyId);
    if (isMetrcSandboxPlaceholderLicense(license)) {
      const locationsRequest = await resolveMetrcLocationsActiveRequest({
        client,
        loaded,
        companyId: input.companyId,
        purpose: "harvest_create_test",
      });
      license = locationsRequest.params.licenseNumber;
    }

    const requestBody = buildMetrcCreateHarvestBody({
      plantBatchName,
      harvestName,
      harvestType,
      locationName,
      wetWeight,
      unitOfWeight,
      actualDate,
      plantCount,
      notes: input.notes ?? null,
    });

    const candidates = buildCreatePathCandidates(license);
    const startedAt = Date.now();
    let lastStatus = 502;
    let lastMessage = "METRC harvest create failed.";
    let lastEndpoint: string | undefined;
    let lastResponse: unknown = null;

    for (const pathname of candidates) {
      const result = await client.post<unknown>(pathname, requestBody);
      lastEndpoint = pathname.split("?")[0];

      if (!isMetrcClientFailure(result)) {
        const durationMs = Date.now() - startedAt;
        const syncedAt = new Date();
        const syncedAtIso = syncedAt.toISOString();
        const metrcHarvestId = extractCreatedHarvestId(result.data, harvestName);

        await upsertMetrcHarvestsForCompany(input.companyId, [
          {
            metrcHarvestId,
            licenseNumber: license,
            harvestName,
            sourcePlantBatchId: plantBatch.metrcPlantBatchId,
            sourcePlantBatchName: plantBatchName,
            strainName: plantBatch.strainName,
            metrcLocationId: plantBatch.metrcLocationId,
            locationName,
            harvestType,
            wetWeight,
            totalWeight: wetWeight,
            unitOfWeight,
            patientLicenseNumber: "",
            plantedDate: new Date(`${actualDate}T12:00:00.000Z`),
            finishedDate: null,
            active: true,
            createdViaTest: true,
            rawPayloadJson: JSON.stringify(result.data ?? {}),
            lastModified: syncedAt,
            lastSyncedAt: syncedAt,
          },
        ]);

        const logPayload = {
          companyId: input.companyId,
          action: "create_test",
          method: "POST",
          endpoint: lastEndpoint,
          httpStatus: result.status,
          requestPayload: { pathname, body: requestBody, plantBatch },
          responsePayload: result.data,
          durationMs,
          actorUserId: input.actorUserId,
        };
        await appendMetrcHarvestRequestLog(logPayload);

        const syncResult = await this.harvestsSyncService.syncMetrcHarvests({
          companyId: input.companyId,
          actorUserId: input.actorUserId,
        });

        let harvest: MetrcHarvestDto;
        if (syncResult.ok) {
          harvest =
            syncResult.harvests.find(
              (h) =>
                h.metrcHarvestId === metrcHarvestId ||
                h.harvestName.trim().toLowerCase() === harvestName.toLowerCase(),
            ) ?? {
              metrcHarvestId,
              harvestName,
              sourcePlantBatchId: plantBatch.metrcPlantBatchId,
              sourcePlantBatchName: plantBatchName,
              strainName: plantBatch.strainName,
              metrcLocationId: plantBatch.metrcLocationId,
              locationName,
              harvestType,
              wetWeight,
              totalWeight: wetWeight,
              unitOfWeight,
              patientLicenseNumber: "",
              plantedDate: `${actualDate}T12:00:00.000Z`,
              finishedDate: null,
              active: true,
              licenseNumber: license,
              createdViaTest: true,
              lastSyncedAt: syncedAtIso,
            };
        } else {
          harvest = {
            metrcHarvestId,
            harvestName,
            sourcePlantBatchId: plantBatch.metrcPlantBatchId,
            sourcePlantBatchName: plantBatchName,
            strainName: plantBatch.strainName,
            metrcLocationId: plantBatch.metrcLocationId,
            locationName,
            harvestType,
            wetWeight,
            totalWeight: wetWeight,
            unitOfWeight,
            patientLicenseNumber: "",
            plantedDate: `${actualDate}T12:00:00.000Z`,
            finishedDate: null,
            active: true,
            licenseNumber: license,
            createdViaTest: true,
            lastSyncedAt: syncedAtIso,
          };
        }

        logInfo("[METRC] harvest_create_test_success", {
          companyId: input.companyId,
          endpoint: lastEndpoint,
          status: result.status,
          metrcHarvestId,
          syncOk: syncResult.ok,
        });

        return {
          ok: true,
          status: result.status,
          message: syncResult.ok
            ? "Test harvest created in METRC sandbox and harvests re-synced."
            : "Test harvest submitted to METRC sandbox. Harvest sync did not complete — run Sync Harvests.",
          alreadyExists: false,
          endpoint: lastEndpoint,
          requestPayload: logPayload.requestPayload,
          responsePayload: result.data,
          durationMs,
          metrcHarvestId,
          harvest,
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

      if (result.status !== 404) break;
    }

    const durationMs = Date.now() - startedAt;
    await appendMetrcHarvestRequestLog({
      companyId: input.companyId,
      action: "create_test",
      method: "POST",
      endpoint: lastEndpoint ?? "harvests/create",
      httpStatus: lastStatus,
      requestPayload: { body: requestBody, candidates },
      responsePayload: lastResponse,
      durationMs,
      actorUserId: input.actorUserId,
    });

    if (lastStatus === 401 || lastStatus === 403) {
      logMetrcCredentialDiagnostics({
        companyId: input.companyId,
        purpose: "harvest_create_test",
        userKeyLength: loaded.userApiKey.length,
        vendorKeyLength: loaded.vendorApiKey.length,
        licensePresent: Boolean(license),
      });
    }

    logWarn("[METRC] harvest_create_test_failed", {
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
      requestPayload: { body: requestBody, candidates },
      responsePayload: lastResponse,
      metrcMessage:
        lastResponse && typeof lastResponse === "object" && "metrcMessage" in lastResponse
          ? String((lastResponse as { metrcMessage?: unknown }).metrcMessage || "")
          : undefined,
    };
  }
}
