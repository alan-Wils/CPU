import { logInfo, logWarn } from "../lib/logger.js";
import { MetrcClient, isMetrcClientFailure } from "../lib/metrcClient.js";
import { loadCompanyMetrcConfig } from "../lib/metrcConfigLoader.js";
import {
  buildMetrcCredentialHintFromLoaded,
  logMetrcCredentialDiagnostics,
} from "../lib/metrcCredentialDiagnostics.js";
import { metrcPullFailureMessage } from "../lib/metrcEndpoints.js";
import { buildMetrcMotherPlantPackageBody } from "../lib/metrcPlantBatchMotherPackageBodies.js";
import {
  appendMetrcPlantBatchRequestLog,
  findMetrcPlantBatchByMetrcId,
} from "../repositories/metrcPlantBatchRepository.js";

const MOTHER_PLANT_PACKAGE_ENDPOINT = "/plantbatches/v2/packages/frommotherplant";

export type MetrcMotherPlantPackageInput = {
  companyId: string;
  actorUserId: string;
  plantBatchId: number;
  packageTag: string;
  count: number;
  actualDate: string;
  locationName?: string | null;
  itemName?: string | null;
};

export type MetrcMotherPlantPackageSuccess = {
  ok: true;
  status: number;
  message: string;
  endpoint: string;
  requestPayload: { pathname: string; body: unknown };
  responsePayload: unknown;
  durationMs: number;
  packageTag: string;
  plantBatchId: number;
};

export type MetrcMotherPlantPackageFailure = {
  ok: false;
  status: number;
  message: string;
  credentialHint?: string;
  endpoint?: string;
  requestPayload?: { pathname: string; body: unknown };
  responsePayload?: unknown;
  metrcMessage?: string;
};

export type MetrcMotherPlantPackageResponse =
  | MetrcMotherPlantPackageSuccess
  | MetrcMotherPlantPackageFailure;

function licenseQuery(licenseNumber: string): string {
  const license = String(licenseNumber || "").trim();
  return license ? `?licenseNumber=${encodeURIComponent(license)}` : "";
}

export class MetrcPlantBatchMotherPackageService {
  async createPackageFromMotherPlant(
    input: MetrcMotherPlantPackageInput,
  ): Promise<MetrcMotherPlantPackageResponse> {
    logInfo("[METRC] plant_batch_mother_package_start", {
      companyId: input.companyId,
      plantBatchId: input.plantBatchId,
      packageTag: input.packageTag,
    });

    const loaded = await loadCompanyMetrcConfig(input.companyId);
    if (!loaded) {
      return { ok: false, status: 404, message: "Company configuration not found." };
    }

    if (loaded.environment !== "sandbox") {
      return {
        ok: false,
        status: 403,
        message:
          "Create package from mother plant is sandbox-only. Switch METRC environment to sandbox.",
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
        message: "Facility license number is required for METRC plant batch package creation.",
      };
    }

    const plantBatch = await findMetrcPlantBatchByMetrcId(
      input.companyId,
      String(input.plantBatchId),
    );
    const plantBatchName = plantBatch?.name?.trim() || null;

    const requestBody = buildMetrcMotherPlantPackageBody({
      plantBatchId: input.plantBatchId,
      plantBatchName,
      packageTag: input.packageTag,
      count: input.count,
      actualDate: input.actualDate,
      locationName: input.locationName,
      itemName: input.itemName,
    });

    const pathname = `${MOTHER_PLANT_PACKAGE_ENDPOINT}${licenseQuery(license)}`;
    const endpointKey = MOTHER_PLANT_PACKAGE_ENDPOINT;
    const requestPayload = { pathname, body: requestBody };

    const client = MetrcClient.fromLoadedConfig(loaded, input.companyId);
    const startedAt = Date.now();
    const result = await client.post<unknown>(pathname, requestBody);

    if (isMetrcClientFailure(result)) {
      const durationMs = Date.now() - startedAt;
      const message = metrcPullFailureMessage(result.status, result.metrcMessage || result.message);
      if (result.status === 401 || result.status === 403) {
        logMetrcCredentialDiagnostics({
          companyId: input.companyId,
          purpose: "plant_batch_mother_package_test",
          userKeyLength: loaded.userApiKey.length,
          vendorKeyLength: loaded.vendorApiKey.length,
          licensePresent: Boolean(license),
        });
      }
      await appendMetrcPlantBatchRequestLog({
        companyId: input.companyId,
        action: "mother_plant_package_test",
        method: "POST",
        endpoint: endpointKey,
        httpStatus: result.status,
        requestPayload,
        responsePayload: result,
        durationMs,
        actorUserId: input.actorUserId,
      });
      logWarn("[METRC] plant_batch_mother_package_failed", {
        companyId: input.companyId,
        status: result.status,
        message,
      });
      return {
        ok: false,
        status: result.status,
        message,
        credentialHint:
          result.status === 401 || result.status === 403
            ? buildMetrcCredentialHintFromLoaded(loaded)
            : undefined,
        endpoint: endpointKey,
        requestPayload,
        responsePayload: result,
        metrcMessage: result.metrcMessage,
      };
    }

    const durationMs = Date.now() - startedAt;
    await appendMetrcPlantBatchRequestLog({
      companyId: input.companyId,
      action: "mother_plant_package_test",
      method: "POST",
      endpoint: endpointKey,
      httpStatus: result.status,
      requestPayload,
      responsePayload: result.data,
      durationMs,
      actorUserId: input.actorUserId,
    });

    logInfo("[METRC] plant_batch_mother_package_success", {
      companyId: input.companyId,
      plantBatchId: input.plantBatchId,
      packageTag: input.packageTag,
      status: result.status,
      durationMs,
    });

    return {
      ok: true,
      status: result.status,
      message: "Mother plant package submitted to METRC sandbox.",
      endpoint: endpointKey,
      requestPayload,
      responsePayload: result.data,
      durationMs,
      packageTag: input.packageTag.trim(),
      plantBatchId: input.plantBatchId,
    };
  }
}
