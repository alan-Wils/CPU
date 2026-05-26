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
  listPlantCapableMetrcLocations,
  resolveHarvestDryingLocation,
  resolvePlantGrowthLocation,
} from "../lib/metrcLocationCapabilities.js";
import { resolveMetrcLocationsActiveRequest } from "../lib/metrcLocationsActiveQuery.js";
import { isMetrcSandboxPlaceholderLicense } from "../lib/metrcOperationalStatus.js";
import {
  appendMetrcHarvestRequestLog,
  findMetrcHarvestByName,
  upsertMetrcHarvestsForCompany,
} from "../repositories/metrcHarvestRepository.js";
import { listMetrcPlantsForPlantBatch } from "../repositories/metrcPlantRepository.js";
import type { MetrcHarvestDto } from "./metrcHarvestsSyncService.js";
import { MetrcHarvestsSyncService } from "./metrcHarvestsSyncService.js";
import { MetrcPlantBatchGrowthPhaseService } from "./metrcPlantBatchGrowthPhaseService.js";
import { MetrcPlantsSyncService } from "./metrcPlantsSyncService.js";

export const METRC_DEFAULT_TEST_HARVEST_NAME = "NexBatch Test Harvest";

export const METRC_HARVEST_TYPES = ["Product", "WholePlant"] as const;
export type MetrcHarvestType = (typeof METRC_HARVEST_TYPES)[number];

export type MetrcHarvestSourceType = "plant" | "plantBatch";

export type MetrcCreateTestHarvestInput = {
  companyId: string;
  actorUserId: string;
  metrcPlantBatchId?: string | null;
  metrcPlantLabels?: string[] | null;
  harvestName: string;
  harvestType?: string | null;
  wetWeight?: number | null;
  unitOfWeight?: string | null;
  actualDate?: string | null;
  plantCount?: number | null;
  notes?: string | null;
  autoPromoteBatch?: boolean | null;
  /** For POST /plantbatches/v2/growthphase NewLocation (ForPlants=true). */
  growthLocationName?: string | null;
  metrcGrowthLocationId?: string | null;
  /** For PUT /plants/v2/harvest DryingLocation (ForHarvests=true). */
  dryingLocationName?: string | null;
  metrcDryingLocationId?: string | null;
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
  plantLabelsUsed: string[];
  promotedBatch: boolean;
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
  sourceType?: MetrcHarvestSourceType;
  sourceName?: string;
};

export type MetrcCreateTestHarvestResponse =
  | MetrcCreateTestHarvestSuccess
  | MetrcCreateTestHarvestFailure;

function licenseQuery(licenseNumber: string): string {
  const license = String(licenseNumber || "").trim();
  return license ? `?licenseNumber=${encodeURIComponent(license)}` : "";
}

function normalizeHarvestType(raw: string | null | undefined): MetrcHarvestType {
  const trimmed = String(raw ?? "").trim();
  if (trimmed.toLowerCase() === "wholeplant") return "WholePlant";
  return "Product";
}

function buildHarvestPlantsBody(input: {
  plantLabels: string[];
  harvestName: string;
  locationName: string;
  wetWeight: number;
  unitOfWeight: string;
  actualDate: string;
}): unknown[] {
  const perPlantWeight =
    input.plantLabels.length > 0
      ? Math.round((input.wetWeight / input.plantLabels.length) * 100) / 100
      : input.wetWeight;

  return input.plantLabels.map((label) => ({
    Plant: label,
    Weight: perPlantWeight,
    UnitOfWeight: input.unitOfWeight,
    DryingLocation: input.locationName || null,
    DryingSublocation: null,
    HarvestName: input.harvestName,
    PatientLicenseNumber: null,
    ActualDate: input.actualDate,
  }));
}

function buildHarvestDiagnostics(input: {
  sourceType: MetrcHarvestSourceType;
  sourceName: string;
  endpoint: string;
  payload: unknown;
  plantLabels: string[];
  promotedBatch: boolean;
  growthLocationName: string;
  dryingLocationName: string;
}): Record<string, unknown> {
  return {
    sourceType: input.sourceType,
    sourceName: input.sourceName,
    endpoint: input.endpoint,
    payload: input.payload,
    plantLabels: input.plantLabels,
    promotedBatch: input.promotedBatch,
    growthLocationName: input.growthLocationName,
    dryingLocationName: input.dryingLocationName,
  };
}

function extractCreatedHarvestId(response: unknown, harvestName: string): string | null {
  if (!response || typeof response !== "object") return null;
  const data = response as Record<string, unknown>;
  const ids = data.Ids ?? data.ids;
  if (Array.isArray(ids) && ids.length > 0) {
    return String(ids[0] ?? "").trim() || null;
  }
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

async function resolvePlantBatchNameConflict(input: {
  companyId: string;
  labels: string[];
}): Promise<{ ok: true; labels: string[] } | { ok: false; message: string; batchName: string }> {
  const trimmed = input.labels.map((l) => l.trim()).filter(Boolean);
  if (!trimmed.length) return { ok: true, labels: [] };

  const batches = await prisma.metrcPlantBatch.findMany({ where: { companyId: input.companyId } });
  const batchNames = new Set(batches.map((b) => b.name.trim().toLowerCase()).filter(Boolean));
  const plants = await prisma.metrcPlant.findMany({
    where: { companyId: input.companyId, label: { in: trimmed } },
  });
  const plantLabelSet = new Set(plants.map((p) => p.label.trim().toLowerCase()));

  for (const label of trimmed) {
    const lower = label.toLowerCase();
    if (batchNames.has(lower) && !plantLabelSet.has(lower)) {
      return {
        ok: false,
        message:
          `"${label}" is a plant batch name, not an individual METRC plant tag. Promote the batch to flowering (tagged plants) before harvest.`,
        batchName: label,
      };
    }
  }

  return { ok: true, labels: trimmed };
}

export class MetrcHarvestCreateService {
  harvestsSyncService = new MetrcHarvestsSyncService();
  plantsSyncService = new MetrcPlantsSyncService();
  growthPhaseService = new MetrcPlantBatchGrowthPhaseService();

  async createTestHarvest(input: MetrcCreateTestHarvestInput): Promise<MetrcCreateTestHarvestResponse> {
    const harvestName = String(input.harvestName || "").trim();
    const metrcPlantBatchId = String(input.metrcPlantBatchId || "").trim();
    const explicitLabels = (input.metrcPlantLabels ?? [])
      .map((l) => String(l || "").trim())
      .filter(Boolean);
    const harvestType = normalizeHarvestType(input.harvestType);
    const autoPromote = input.autoPromoteBatch !== false;
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
      explicitPlantLabelCount: explicitLabels.length,
    });

    if (!harvestName) {
      return { ok: false, status: 400, message: "Harvest name is required." };
    }
    if (!metrcPlantBatchId && explicitLabels.length === 0) {
      return {
        ok: false,
        status: 400,
        message: "Select a plant batch and individual plant tag(s), or provide METRC plant labels.",
      };
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
        endpoint: "plants/v2/harvest",
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
        endpoint: "plants/v2/harvest",
        requestPayload: { harvestName, metrcPlantBatchId },
        responsePayload: { alreadyExists: true },
        durationMs: 0,
        metrcHarvestId: existing.metrcHarvestId,
        harvest: rowToDto(existing),
        plantLabelsUsed: [],
        promotedBatch: false,
      };
    }

    let plantBatch: Awaited<ReturnType<typeof prisma.metrcPlantBatch.findFirst>> = null;
    if (metrcPlantBatchId) {
      plantBatch = await prisma.metrcPlantBatch.findFirst({
        where: { companyId: input.companyId, metrcPlantBatchId },
      });
      if (!plantBatch) {
        return {
          ok: false,
          status: 400,
          message: "Plant batch not found in NexBatch. Sync plant batches first.",
          sourceType: "plantBatch",
          sourceName: metrcPlantBatchId,
        };
      }
    }

    const explicitLabelCheck = await resolvePlantBatchNameConflict({
      companyId: input.companyId,
      labels: explicitLabels,
    });
    if (explicitLabelCheck.ok === false) {
      return {
        ok: false,
        status: 400,
        message: explicitLabelCheck.message,
        sourceType: "plantBatch",
        sourceName: explicitLabelCheck.batchName,
      };
    }

    const plantCapableLocations = await listPlantCapableMetrcLocations(input.companyId);
    if (!plantCapableLocations.length) {
      return {
        ok: false,
        status: 400,
        message:
          "No plant-capable METRC location is mapped. Sync locations and ensure at least one location has ForPlants=true.",
      };
    }

    const growthLocation = await resolvePlantGrowthLocation({
      companyId: input.companyId,
      metrcLocationId: input.metrcGrowthLocationId,
      locationName: input.growthLocationName,
    });
    if (growthLocation.ok === false) {
      return {
        ok: false,
        status: growthLocation.status,
        message: growthLocation.message,
        sourceType: "plantBatch",
        sourceName: plantBatch?.name ?? metrcPlantBatchId,
      };
    }

    const dryingLocation = await resolveHarvestDryingLocation({
      companyId: input.companyId,
      metrcLocationId: input.metrcDryingLocationId,
      locationName: input.dryingLocationName,
    });
    if (dryingLocation.ok === false) {
      return {
        ok: false,
        status: dryingLocation.status,
        message: dryingLocation.message,
        sourceType: "plantBatch",
        sourceName: plantBatch?.name ?? metrcPlantBatchId,
      };
    }

    const growthLocationName = growthLocation.location.name;
    const dryingLocationName = dryingLocation.location.name;

    let plantLabels = explicitLabelCheck.labels;
    let promotedBatch = false;
    const plantBatchName = plantBatch?.name.trim() ?? "";
    const maxPlants =
      typeof input.plantCount === "number" && input.plantCount > 0
        ? Math.floor(input.plantCount)
        : plantBatch
          ? Math.max(1, Math.min(5, Math.floor(plantBatch.count) || 1))
          : explicitLabels.length || 1;

    if (!plantLabels.length && plantBatch) {
      let batchPlants = await listMetrcPlantsForPlantBatch(input.companyId, {
        metrcPlantBatchId: plantBatch.metrcPlantBatchId,
        name: plantBatch.name,
      });

      if (!batchPlants.length && autoPromote) {
        const promote = await this.growthPhaseService.promotePlantBatchToTaggedPlants({
          companyId: input.companyId,
          actorUserId: input.actorUserId,
          plantBatchName: plantBatch.name,
          count: maxPlants,
          growthLocationName,
          metrcGrowthLocationId: growthLocation.location.metrcLocationId,
          growthPhase: "Flowering",
          growthDate: actualDate,
        });
        if (!promote.ok) {
          return {
            ok: false,
            status: promote.status,
            message: promote.message,
            endpoint: promote.endpoint,
            requestPayload: promote.requestPayload,
            responsePayload: promote.responsePayload,
            sourceType: "plantBatch",
            sourceName: plantBatchName,
          };
        }
        promotedBatch = true;

        const syncPlants = await this.plantsSyncService.syncMetrcPlants({
          companyId: input.companyId,
          actorUserId: input.actorUserId,
        });
        if (syncPlants.ok === false) {
          return {
            ok: false,
            status: syncPlants.status,
            message: `Batch promoted but plant sync failed: ${syncPlants.message}`,
            sourceType: "plantBatch",
            sourceName: plantBatchName,
          };
        }

        batchPlants = await listMetrcPlantsForPlantBatch(input.companyId, {
          metrcPlantBatchId: plantBatch.metrcPlantBatchId,
          name: plantBatch.name,
        });
      }

      plantLabels = batchPlants.slice(0, maxPlants).map((p) => p.label);
    }

    if (!plantLabels.length) {
      return {
        ok: false,
        status: 400,
        message: plantBatch
          ? `No individual METRC plant tags found for batch "${plantBatchName}". This is a plant batch, not an individual plant — promote the batch to flowering and sync plants before harvest.`
          : "No METRC plant labels available for harvest.",
        sourceType: plantBatch ? "plantBatch" : "plant",
        sourceName: plantBatchName || metrcPlantBatchId,
      };
    }

    const batchNameGuard = await resolvePlantBatchNameConflict({
      companyId: input.companyId,
      labels: plantLabels,
    });
    if (batchNameGuard.ok === false) {
      return {
        ok: false,
        status: 400,
        message: batchNameGuard.message,
        sourceType: "plantBatch",
        sourceName: batchNameGuard.batchName,
      };
    }
    plantLabels = batchNameGuard.labels;

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

    const requestBody = buildHarvestPlantsBody({
      plantLabels,
      harvestName,
      locationName: dryingLocationName,
      wetWeight,
      unitOfWeight,
      actualDate,
    });

    const harvestPath = `/plants/v2/harvest${licenseQuery(license)}`;
    const fallbackPath = `/plants/v1/harvestplants${licenseQuery(license)}`;
    const startedAt = Date.now();
    let lastStatus = 502;
    let lastMessage = "METRC harvest create failed.";
    let lastEndpoint = "plants/v2/harvest";
    let lastResponse: unknown = null;

    const diagnostics = buildHarvestDiagnostics({
      sourceType: "plant",
      sourceName: plantLabels.join(", "),
      endpoint: lastEndpoint,
      payload: requestBody,
      plantLabels,
      promotedBatch,
      growthLocationName,
      dryingLocationName,
    });

    for (const pathname of [harvestPath, fallbackPath]) {
      lastEndpoint = pathname.split("?")[0]!;
      diagnostics.endpoint = lastEndpoint;

      const result = await client.put<unknown>(pathname, requestBody);

      if (!isMetrcClientFailure(result)) {
        const durationMs = Date.now() - startedAt;
        const syncedAt = new Date();
        const syncedAtIso = syncedAt.toISOString();
        const metrcHarvestId = extractCreatedHarvestId(result.data, harvestName) ?? plantLabels[0]!;

        await upsertMetrcHarvestsForCompany(input.companyId, [
          {
            metrcHarvestId,
            licenseNumber: license,
            harvestName,
            sourcePlantBatchId: plantBatch?.metrcPlantBatchId ?? "",
            sourcePlantBatchName: plantBatchName,
            strainName: plantBatch?.strainName ?? "",
            metrcLocationId: dryingLocation.location.metrcLocationId,
            locationName: dryingLocationName,
            harvestType,
            wetWeight,
            totalWeight: wetWeight,
            unitOfWeight,
            patientLicenseNumber: "",
            plantedDate: new Date(`${actualDate}T12:00:00.000Z`),
            finishedDate: null,
            active: true,
            createdViaTest: true,
            sourcePlantLabelsJson: JSON.stringify(plantLabels),
            rawPayloadJson: JSON.stringify(result.data ?? {}),
            lastModified: syncedAt,
            lastSyncedAt: syncedAt,
          },
        ]);

        await appendMetrcHarvestRequestLog({
          companyId: input.companyId,
          action: "create_test",
          method: "PUT",
          endpoint: lastEndpoint,
          httpStatus: result.status,
          requestPayload: diagnostics,
          responsePayload: result.data,
          durationMs,
          actorUserId: input.actorUserId,
        });

        const syncResult = await this.harvestsSyncService.syncMetrcHarvests({
          companyId: input.companyId,
          actorUserId: input.actorUserId,
        });

        const fallbackHarvest: MetrcHarvestDto = {
          metrcHarvestId,
          harvestName,
          sourcePlantBatchId: plantBatch?.metrcPlantBatchId ?? "",
          sourcePlantBatchName: plantBatchName,
          strainName: plantBatch?.strainName ?? "",
          metrcLocationId: dryingLocation.location.metrcLocationId,
          locationName: dryingLocationName,
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

        let harvest = fallbackHarvest;
        if (syncResult.ok) {
          harvest =
            syncResult.harvests.find(
              (h) =>
                h.metrcHarvestId === metrcHarvestId ||
                h.harvestName.trim().toLowerCase() === harvestName.toLowerCase(),
            ) ?? fallbackHarvest;
        }

        logInfo("[METRC] harvest_create_test_success", {
          companyId: input.companyId,
          endpoint: lastEndpoint,
          status: result.status,
          metrcHarvestId,
          plantLabelCount: plantLabels.length,
          promotedBatch,
          syncOk: syncResult.ok,
        });

        return {
          ok: true,
          status: result.status,
          message: promotedBatch
            ? `Promoted batch to flowering, harvested ${plantLabels.length} plant(s), and re-synced harvests.`
            : syncResult.ok
              ? `Harvested ${plantLabels.length} plant(s) in METRC sandbox and re-synced harvests.`
              : `Harvest submitted for ${plantLabels.length} plant(s). Run Sync Harvests to refresh.`,
          alreadyExists: false,
          endpoint: lastEndpoint,
          requestPayload: diagnostics,
          responsePayload: result.data,
          durationMs,
          metrcHarvestId,
          harvest,
          plantLabelsUsed: plantLabels,
          promotedBatch,
        };
      }

      lastStatus = result.status || 502;
      lastMessage = metrcPullFailureMessage(lastStatus, result.metrcMessage || result.message);
      lastResponse = {
        status: result.status,
        message: result.message,
        metrcMessage: result.metrcMessage,
        endpoint: result.endpoint,
      };

      if (result.status !== 404) break;
    }

    const durationMs = Date.now() - startedAt;
    await appendMetrcHarvestRequestLog({
      companyId: input.companyId,
      action: "create_test",
      method: "PUT",
      endpoint: lastEndpoint,
      httpStatus: lastStatus,
      requestPayload: diagnostics,
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
      plantLabels,
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
      requestPayload: diagnostics,
      responsePayload: lastResponse,
      metrcMessage:
        lastResponse && typeof lastResponse === "object" && "metrcMessage" in lastResponse
          ? String((lastResponse as { metrcMessage?: unknown }).metrcMessage || "")
          : undefined,
      sourceType: "plant",
      sourceName: plantLabels.join(", "),
    };
  }
}
