import { logInfo, logWarn } from "../lib/logger.js";
import {
  MetrcClient,
  describeMetrcAuthMode,
  isMetrcClientFailure,
  type MetrcClientAuthMode,
} from "../lib/metrcClient.js";
import { loadCompanyMetrcConfig, type LoadedMetrcConfig } from "../lib/metrcConfigLoader.js";
import {
  buildMetrcCredentialHintFromLoaded,
  logMetrcCredentialDiagnostics,
} from "../lib/metrcCredentialDiagnostics.js";
import { metrcPullFailureMessage } from "../lib/metrcEndpoints.js";
import { resolveMetrcLocationsActiveRequest } from "../lib/metrcLocationsActiveQuery.js";
import { buildMetrcMotherPlantPackageBody } from "../lib/metrcPlantBatchMotherPackageBodies.js";
import { isMetrcSandboxPlaceholderLicense } from "../lib/metrcOperationalStatus.js";
import { resolveMetrcApiBaseUrl } from "../lib/metrcResolveBaseUrl.js";
import {
  appendMetrcPlantBatchRequestLog,
  findMetrcPlantBatchByMetrcId,
  findMetrcPlantBatchByName,
} from "../repositories/metrcPlantBatchRepository.js";

const MOTHER_PLANT_PACKAGE_ENDPOINT = "/plantbatches/v2/packages/frommotherplant";

const METRC_AUTH_PERMISSION_MESSAGE =
  "METRC rejected this endpoint for the current sandbox credentials/facility. This is an authorization/permission issue, not a form input issue.";

export type MetrcMotherPlantRequestDebug = {
  licenseNumber: string;
  authMode: string;
  baseUrl: string;
  endpoint: string;
  payloadBody: unknown;
};

export type MetrcMotherPlantPackageInput = {
  companyId: string;
  actorUserId: string;
  plantBatchName: string;
  plantBatchId?: number | null;
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
  requestPayload: { pathname: string; body: unknown; requestDebug: MetrcMotherPlantRequestDebug };
  requestDebug: MetrcMotherPlantRequestDebug;
  responsePayload: unknown;
  durationMs: number;
  packageTag: string;
  plantBatchName: string;
};

export type MetrcMotherPlantPackageFailure = {
  ok: false;
  status: number;
  message: string;
  credentialHint?: string;
  endpoint?: string;
  requestPayload?: { pathname: string; body: unknown; requestDebug: MetrcMotherPlantRequestDebug };
  requestDebug?: MetrcMotherPlantRequestDebug;
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

function authModeLabel(mode: MetrcClientAuthMode, loaded: LoadedMetrcConfig): string {
  return describeMetrcAuthMode(mode, {
    environment: loaded.environment,
    stateCode: loaded.stateCode,
    apiBaseUrlOverride: loaded.apiBaseUrlOverride,
    vendorApiKey: loaded.vendorApiKey,
    userApiKey: loaded.userApiKey,
    username: loaded.username,
    licenseNumber: loaded.licenseNumber,
  }).auth_mode;
}

function buildRequestDebug(input: {
  licenseNumber: string;
  authMode: string;
  baseUrl: string;
  payloadBody: unknown;
}): MetrcMotherPlantRequestDebug {
  return {
    licenseNumber: input.licenseNumber,
    authMode: input.authMode,
    baseUrl: input.baseUrl,
    endpoint: MOTHER_PLANT_PACKAGE_ENDPOINT,
    payloadBody: input.payloadBody,
  };
}

export class MetrcPlantBatchMotherPackageService {
  async createPackageFromMotherPlant(
    input: MetrcMotherPlantPackageInput,
  ): Promise<MetrcMotherPlantPackageResponse> {
    logInfo("[METRC] plant_batch_mother_package_start", {
      companyId: input.companyId,
      plantBatchName: input.plantBatchName,
      plantBatchId: input.plantBatchId ?? null,
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

    const plantBatchFromId =
      input.plantBatchId != null && input.plantBatchId > 0
        ? await findMetrcPlantBatchByMetrcId(input.companyId, String(input.plantBatchId))
        : null;
    const plantBatchFromName = await findMetrcPlantBatchByName(
      input.companyId,
      input.plantBatchName,
    );
    const plantBatch = plantBatchFromId ?? (plantBatchFromName
      ? await findMetrcPlantBatchByMetrcId(
          input.companyId,
          plantBatchFromName.metrcPlantBatchId,
        )
      : null);

    const plantBatchName =
      plantBatch?.name?.trim() ||
      input.plantBatchName.trim() ||
      plantBatchFromName?.name?.trim() ||
      "";
    if (!plantBatchName) {
      return {
        ok: false,
        status: 400,
        message: "Plant batch name is required for METRC from-mother-plant package creation.",
      };
    }

    let license = String(
      plantBatch?.licenseNumber || loaded.licenseNumber || "",
    ).trim();
    if (!license) {
      return {
        ok: false,
        status: 400,
        message: "Facility license number is required for METRC plant batch package creation.",
      };
    }

    const client = MetrcClient.fromLoadedConfig(loaded, input.companyId);
    const baseUrl =
      client.baseUrl ||
      resolveMetrcApiBaseUrl({
        environment: loaded.environment,
        stateCode: loaded.stateCode,
        apiBaseUrlOverride: loaded.apiBaseUrlOverride,
      }) ||
      "";

    if (isMetrcSandboxPlaceholderLicense(license)) {
      const locationsRequest = await resolveMetrcLocationsActiveRequest({
        client,
        loaded,
        companyId: input.companyId,
        purpose: "plant_batch_mother_package_test",
      });
      license = locationsRequest.params.licenseNumber;
    }

    const locationName =
      String(input.locationName || "").trim() ||
      plantBatch?.locationName?.trim() ||
      null;

    const requestBody = buildMetrcMotherPlantPackageBody({
      plantBatchName,
      packageTag: input.packageTag,
      count: input.count,
      actualDate: input.actualDate,
      locationName,
      itemName: input.itemName,
    });

    const pathname = `${MOTHER_PLANT_PACKAGE_ENDPOINT}${licenseQuery(license)}`;
    const endpointKey = MOTHER_PLANT_PACKAGE_ENDPOINT;
    const startedAt = Date.now();
    const result = await client.post<unknown>(pathname, requestBody);
    const durationMs = Date.now() - startedAt;

    const authMode = isMetrcClientFailure(result)
      ? authModeLabel(
          result.authAttempts[result.authAttempts.length - 1]?.mode ??
            result.attemptedAuthModes[result.attemptedAuthModes.length - 1] ??
            "sandbox_basic_vendor_user",
          loaded,
        )
      : authModeLabel(result.authMode, loaded);

    const requestDebug = buildRequestDebug({
      licenseNumber: license,
      authMode,
      baseUrl,
      payloadBody: requestBody,
    });
    const requestPayload = { pathname, body: requestBody, requestDebug };

    if (isMetrcClientFailure(result)) {
      const isAuthDenied = result.status === 401 || result.status === 403;
      const message = isAuthDenied
        ? METRC_AUTH_PERMISSION_MESSAGE
        : metrcPullFailureMessage(result.status, result.metrcMessage || result.message);
      if (isAuthDenied) {
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
        requestDebug,
      });
      return {
        ok: false,
        status: result.status,
        message,
        credentialHint: isAuthDenied ? buildMetrcCredentialHintFromLoaded(loaded) : undefined,
        endpoint: endpointKey,
        requestPayload,
        requestDebug,
        responsePayload: result,
        metrcMessage: result.metrcMessage,
      };
    }

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
      plantBatchName,
      packageTag: input.packageTag,
      status: result.status,
      durationMs,
      requestDebug,
    });

    return {
      ok: true,
      status: result.status,
      message: "Mother plant package submitted to METRC sandbox.",
      endpoint: endpointKey,
      requestPayload,
      requestDebug,
      responsePayload: result.data,
      durationMs,
      packageTag: input.packageTag.trim(),
      plantBatchName,
    };
  }
}
