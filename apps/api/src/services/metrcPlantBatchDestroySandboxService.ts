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
import { buildMetrcPlantBatchDestroyBody } from "../lib/metrcPlantBatchDestroyBodies.js";
import { resolveMetrcLocationsActiveRequest } from "../lib/metrcLocationsActiveQuery.js";
import { isMetrcSandboxPlaceholderLicense } from "../lib/metrcOperationalStatus.js";
import { resolveMetrcApiBaseUrl } from "../lib/metrcResolveBaseUrl.js";
import {
  appendMetrcPlantBatchRequestLog,
  findMetrcPlantBatchByMetrcId,
  findMetrcPlantBatchByName,
} from "../repositories/metrcPlantBatchRepository.js";

const PLANT_BATCH_DESTROY_ENDPOINT = "/plantbatches/v2/";

const METRC_AUTH_PERMISSION_MESSAGE =
  "METRC rejected this endpoint for the current sandbox credentials/facility. This is an authorization/permission issue, not a form input issue.";

export type MetrcPlantBatchDestroyRequestDebug = {
  licenseNumber: string;
  authMode: string;
  baseUrl: string;
  endpoint: string;
  payloadBody: unknown;
};

export type MetrcPlantBatchDestroySandboxInput = {
  companyId: string;
  actorUserId: string;
  plantBatchName: string;
  plantBatchId?: number | null;
  count: number;
  actualDate: string;
  wasteReasonName: string;
  reasonNote: string;
  wasteMethodName?: string | null;
  wasteWeight?: number | null;
  wasteUnitOfMeasureName?: string | null;
};

export type MetrcPlantBatchDestroySandboxSuccess = {
  ok: true;
  status: number;
  message: string;
  endpoint: string;
  requestPayload: {
    pathname: string;
    body: unknown;
    requestDebug: MetrcPlantBatchDestroyRequestDebug;
  };
  requestDebug: MetrcPlantBatchDestroyRequestDebug;
  responsePayload: unknown;
  durationMs: number;
  plantBatchName: string;
};

export type MetrcPlantBatchDestroySandboxFailure = {
  ok: false;
  status: number;
  message: string;
  credentialHint?: string;
  endpoint?: string;
  requestPayload?: {
    pathname: string;
    body: unknown;
    requestDebug: MetrcPlantBatchDestroyRequestDebug;
  };
  requestDebug?: MetrcPlantBatchDestroyRequestDebug;
  responsePayload?: unknown;
  metrcMessage?: string;
};

export type MetrcPlantBatchDestroySandboxResponse =
  | MetrcPlantBatchDestroySandboxSuccess
  | MetrcPlantBatchDestroySandboxFailure;

function licenseQuery(licenseNumber: string): string {
  const license = String(licenseNumber || "").trim();
  return license ? `?licenseNumber=${encodeURIComponent(license)}` : "";
}

function authModeLabel(mode: MetrcClientAuthMode, loaded: LoadedMetrcConfig): string {
  return describeMetrcAuthMode(mode, {
    environment: loaded.environment,
    vendorApiKey: loaded.vendorApiKey,
    userApiKey: loaded.userApiKey,
    licenseNumber: loaded.licenseNumber,
  }).auth_mode;
}

function buildRequestDebug(input: {
  licenseNumber: string;
  authMode: string;
  baseUrl: string;
  payloadBody: unknown;
}): MetrcPlantBatchDestroyRequestDebug {
  return {
    licenseNumber: input.licenseNumber,
    authMode: input.authMode,
    baseUrl: input.baseUrl,
    endpoint: PLANT_BATCH_DESTROY_ENDPOINT,
    payloadBody: input.payloadBody,
  };
}

export class MetrcPlantBatchDestroySandboxService {
  async destroyPlantBatch(
    input: MetrcPlantBatchDestroySandboxInput,
  ): Promise<MetrcPlantBatchDestroySandboxResponse> {
    logInfo("[METRC] plant_batch_destroy_sandbox_start", {
      companyId: input.companyId,
      plantBatchName: input.plantBatchName,
      plantBatchId: input.plantBatchId ?? null,
      count: input.count,
    });

    const loaded = await loadCompanyMetrcConfig(input.companyId);
    if (!loaded) {
      return { ok: false, status: 404, message: "Company configuration not found." };
    }

    if (loaded.environment !== "sandbox") {
      return {
        ok: false,
        status: 403,
        message: "Destroy plant batch is sandbox-only. Switch METRC environment to sandbox.",
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
    const plantBatch =
      plantBatchFromId ??
      (plantBatchFromName
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
        message: "Plant batch name is required for METRC plant batch destroy.",
      };
    }

    const actualDate = String(input.actualDate || "").trim();
    if (!actualDate) {
      return {
        ok: false,
        status: 400,
        message: "Actual date is required for METRC plant batch destroy.",
      };
    }

    const wasteReasonName = String(input.wasteReasonName || "").trim();
    if (!wasteReasonName) {
      return {
        ok: false,
        status: 400,
        message: "Waste reason is required for METRC plant batch destroy.",
      };
    }

    const reasonNote = String(input.reasonNote || "").trim();
    if (!reasonNote) {
      return {
        ok: false,
        status: 400,
        message: "Reason note is required for METRC plant batch destroy.",
      };
    }

    let license = String(plantBatch?.licenseNumber || loaded.licenseNumber || "").trim();
    if (!license) {
      return {
        ok: false,
        status: 400,
        message: "Facility license number is required for METRC plant batch destroy.",
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
        purpose: "plant_batch_destroy_test",
      });
      license = locationsRequest.params.licenseNumber;
    }

    const requestBody = buildMetrcPlantBatchDestroyBody({
      plantBatchName,
      count: input.count,
      actualDate,
      wasteReasonName,
      reasonNote,
      wasteMethodName: input.wasteMethodName ?? null,
      wasteWeight: input.wasteWeight ?? null,
      wasteUnitOfMeasureName: input.wasteUnitOfMeasureName ?? null,
    });

    const pathname = `/plantbatches/v2/${licenseQuery(license)}`;
    const endpointKey = PLANT_BATCH_DESTROY_ENDPOINT;
    const startedAt = Date.now();
    const result = await client.request<unknown>({
      method: "DELETE",
      pathnameAndQuery: pathname,
      body: requestBody,
    });
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
          purpose: "plant_batch_destroy_test",
          userKeyLength: loaded.userApiKey.length,
          vendorKeyLength: loaded.vendorApiKey.length,
          licensePresent: Boolean(license),
        });
      }
      await appendMetrcPlantBatchRequestLog({
        companyId: input.companyId,
        action: "destroy_test",
        method: "DELETE",
        endpoint: endpointKey,
        httpStatus: result.status,
        requestPayload,
        responsePayload: result,
        durationMs,
        actorUserId: input.actorUserId,
      });
      logWarn("[METRC] plant_batch_destroy_sandbox_failed", {
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
      action: "destroy_test",
      method: "DELETE",
      endpoint: endpointKey,
      httpStatus: result.status,
      requestPayload,
      responsePayload: result.data,
      durationMs,
      actorUserId: input.actorUserId,
    });

    logInfo("[METRC] plant_batch_destroy_sandbox_success", {
      companyId: input.companyId,
      plantBatchName,
      status: result.status,
      durationMs,
      requestDebug,
    });

    return {
      ok: true,
      status: result.status,
      message: `Plant batch '${plantBatchName}' destroyed in METRC sandbox.`,
      endpoint: endpointKey,
      requestPayload,
      requestDebug,
      responsePayload: result.data,
      durationMs,
      plantBatchName,
    };
  }
}
