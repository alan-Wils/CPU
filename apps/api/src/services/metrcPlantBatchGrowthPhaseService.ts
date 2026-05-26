import { logInfo, logWarn } from "../lib/logger.js";
import { MetrcClient, isMetrcClientFailure } from "../lib/metrcClient.js";
import { loadCompanyMetrcConfig } from "../lib/metrcConfigLoader.js";
import { metrcPullFailureMessage } from "../lib/metrcEndpoints.js";
import { resolveMetrcLocationsActiveRequest } from "../lib/metrcLocationsActiveQuery.js";
import { isMetrcSandboxPlaceholderLicense } from "../lib/metrcOperationalStatus.js";
import { resolvePlantGrowthLocation } from "../lib/metrcLocationCapabilities.js";
import { appendMetrcPlantBatchRequestLog } from "../repositories/metrcPlantBatchRepository.js";
import { MetrcAvailablePlantTagsService } from "./metrcAvailablePlantTagsService.js";

export type MetrcPromotePlantBatchInput = {
  companyId: string;
  actorUserId: string;
  plantBatchName: string;
  count: number;
  /** METRC location name for NewLocation — must have ForPlants=true. */
  growthLocationName: string;
  metrcGrowthLocationId?: string | null;
  growthPhase?: "Vegetative" | "Flowering";
  growthDate?: string | null;
  startingTag?: string | null;
};

export type MetrcPromotePlantBatchSuccess = {
  ok: true;
  status: number;
  message: string;
  endpoint: string;
  startingTag: string;
  requestPayload: unknown;
  responsePayload: unknown;
  durationMs: number;
};

export type MetrcPromotePlantBatchFailure = {
  ok: false;
  status: number;
  message: string;
  endpoint?: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
};

export type MetrcPromotePlantBatchResponse =
  | MetrcPromotePlantBatchSuccess
  | MetrcPromotePlantBatchFailure;

function licenseQuery(licenseNumber: string): string {
  const license = String(licenseNumber || "").trim();
  return license ? `?licenseNumber=${encodeURIComponent(license)}` : "";
}

function buildGrowthPhaseBody(input: {
  plantBatchName: string;
  count: number;
  startingTag: string;
  growthPhase: "Vegetative" | "Flowering";
  locationName: string;
  growthDate: string;
}): unknown[] {
  return [
    {
      Name: input.plantBatchName,
      Count: input.count,
      StartingTag: input.startingTag,
      GrowthPhase: input.growthPhase,
      NewLocation: input.locationName || null,
      NewSublocation: null,
      GrowthDate: input.growthDate,
      PatientLicenseNumber: null,
    },
  ];
}

export class MetrcPlantBatchGrowthPhaseService {
  tagsService = new MetrcAvailablePlantTagsService();

  async promotePlantBatchToTaggedPlants(
    input: MetrcPromotePlantBatchInput,
  ): Promise<MetrcPromotePlantBatchResponse> {
    const plantBatchName = String(input.plantBatchName || "").trim();
    const count = Math.max(1, Math.floor(input.count));
    const growthPhase = input.growthPhase === "Vegetative" ? "Vegetative" : "Flowering";
    const growthDate =
      String(input.growthDate || "").trim() || new Date().toISOString().slice(0, 10);

    logInfo("[METRC] plant_batch_growthphase_start", {
      companyId: input.companyId,
      plantBatchName,
      count,
      growthPhase,
    });

    if (!plantBatchName) {
      return { ok: false, status: 400, message: "Plant batch name is required." };
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
      };
    }
    const locationName = growthLocation.location.name;

    const loaded = await loadCompanyMetrcConfig(input.companyId);
    if (!loaded) {
      return { ok: false, status: 404, message: "Company configuration not found." };
    }
    if (loaded.environment !== "sandbox") {
      return {
        ok: false,
        status: 403,
        message: "Plant batch growth phase changes are sandbox-only in NexBatch test flows.",
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
        message: "Facility license number is required.",
      };
    }

    let startingTag = String(input.startingTag || "").trim();
    if (!startingTag) {
      const tagsResult = await this.tagsService.fetchLabels({
        companyId: input.companyId,
        limit: 1,
      });
      if (tagsResult.ok === false) {
        return {
          ok: false,
          status: tagsResult.status,
          message: tagsResult.message,
        };
      }
      if (!tagsResult.labels.length) {
        return {
          ok: false,
          status: 400,
          message:
            "No METRC plant tags available. Request plant tags in METRC sandbox before promoting a batch.",
        };
      }
      startingTag = tagsResult.labels[0]!;
    }

    const client = MetrcClient.fromLoadedConfig(loaded, input.companyId);
    if (isMetrcSandboxPlaceholderLicense(license)) {
      const locationsRequest = await resolveMetrcLocationsActiveRequest({
        client,
        loaded,
        companyId: input.companyId,
        purpose: "plant_batch_growthphase",
      });
      license = locationsRequest.params.licenseNumber;
    }

    const requestBody = buildGrowthPhaseBody({
      plantBatchName,
      count,
      startingTag,
      growthPhase,
      locationName,
      growthDate,
    });

    const pathname = `/plantbatches/v2/growthphase${licenseQuery(license)}`;
    const startedAt = Date.now();
    const result = await client.post<unknown>(pathname, requestBody);
    const durationMs = Date.now() - startedAt;
    const endpoint = "/plantbatches/v2/growthphase";

    const diagnostics = {
      sourceType: "plantBatch" as const,
      sourceName: plantBatchName,
      endpoint,
      payload: requestBody,
      growthLocationName: locationName,
      metrcGrowthLocationId: growthLocation.location.metrcLocationId,
      forPlants: true,
    };

    if (isMetrcClientFailure(result)) {
      const status = result.status || 502;
      const message = metrcPullFailureMessage(status, result.metrcMessage || result.message);
      await appendMetrcPlantBatchRequestLog({
        companyId: input.companyId,
        action: "growthphase_promote",
        method: "POST",
        endpoint,
        httpStatus: status,
        requestPayload: diagnostics,
        responsePayload: {
          status: result.status,
          message: result.message,
          metrcMessage: result.metrcMessage,
        },
        durationMs,
        actorUserId: input.actorUserId,
      });
      logWarn("[METRC] plant_batch_growthphase_failed", {
        companyId: input.companyId,
        status,
        message,
      });
      return {
        ok: false,
        status,
        message,
        endpoint,
        requestPayload: diagnostics,
        responsePayload: result,
      };
    }

    await appendMetrcPlantBatchRequestLog({
      companyId: input.companyId,
      action: "growthphase_promote",
      method: "POST",
      endpoint,
      httpStatus: result.status,
      requestPayload: diagnostics,
      responsePayload: result.data,
      durationMs,
      actorUserId: input.actorUserId,
    });

    logInfo("[METRC] plant_batch_growthphase_success", {
      companyId: input.companyId,
      plantBatchName,
      startingTag,
      count,
    });

    return {
      ok: true,
      status: result.status,
      message: `Promoted plant batch "${plantBatchName}" to ${growthPhase} with ${count} tagged plant(s).`,
      endpoint,
      startingTag,
      requestPayload: diagnostics,
      responsePayload: result.data,
      durationMs,
    };
  }
}
