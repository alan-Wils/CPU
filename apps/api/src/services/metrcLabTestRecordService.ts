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
import { resolveMetrcApiBaseUrl } from "../lib/metrcResolveBaseUrl.js";
import { findMetrcPackageByLabel } from "../repositories/metrcPackageRepository.js";
import { METRC_COLORADO_SANDBOX_LICENSE } from "./metrcLabTestTypesService.js";

const LAB_TEST_RECORD_ENDPOINT = "/labtests/v2/record";
const METRC_LAB_TEST_401_MESSAGE =
  "METRC returned 401 for documented lab test record payload using same working sandbox auth/license. Contact METRC to enable/verify lab result write permission.";
const METRC_AUTH_PERMISSION_MESSAGE =
  "METRC rejected this endpoint for the current sandbox credentials/facility. This is an authorization/permission issue, not a form input issue.";
const SAME_AUTH_COMPARABLE_LAB_TEST_ENDPOINTS = [
  "GET /labtests/v2/types",
  "POST /plantbatches/v2/plantings",
  "POST /plantbatches/v2/packages",
  "POST /plantbatches/v2/growthphase",
  "DELETE /plantbatches/v2/",
] as const;

export type MetrcLabTestRecordResultInput = {
  labTestTypeName: string;
  quantity: number;
  passed: boolean;
  notes?: string | null;
};

export type MetrcLabTestRecordRequestDebug = {
  licenseNumber: string;
  authMode: string;
  baseUrl: string;
  endpoint: string;
  payloadBody: unknown;
};

export type MetrcLabTestRecordAuthEvidence = {
  endpoint: string;
  finalLicenseNumber: string;
  authMode: string;
  baseUrl: string;
  exactPayload: unknown;
  selectedPackageLabel: string;
  packageFacilityLicense: string | null;
  labTestTypesSourceLicense: string;
  sameAuthUsedByEndpoints: readonly string[];
};

export type MetrcLabTestRecordInput = {
  companyId: string;
  packageLabel: string;
  resultDate: string;
  results: MetrcLabTestRecordResultInput[];
};

export type MetrcLabTestRecordSuccess = {
  ok: true;
  status: number;
  message: string;
  endpoint: string;
  requestPayload: { pathname: string; body: unknown; requestDebug: MetrcLabTestRecordRequestDebug };
  requestDebug: MetrcLabTestRecordRequestDebug;
  responsePayload: unknown;
  durationMs: number;
};

export type MetrcLabTestRecordFailure = {
  ok: false;
  status: number;
  message: string;
  credentialHint?: string;
  endpoint?: string;
  requestPayload?: { pathname: string; body: unknown; requestDebug: MetrcLabTestRecordRequestDebug };
  requestDebug?: MetrcLabTestRecordRequestDebug;
  authEvidence?: MetrcLabTestRecordAuthEvidence;
  responsePayload?: unknown;
  metrcMessage?: string;
};

export type MetrcLabTestRecordResponse = MetrcLabTestRecordSuccess | MetrcLabTestRecordFailure;

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
}): MetrcLabTestRecordRequestDebug {
  return {
    licenseNumber: input.licenseNumber,
    authMode: input.authMode,
    baseUrl: input.baseUrl,
    endpoint: LAB_TEST_RECORD_ENDPOINT,
    payloadBody: input.payloadBody,
  };
}

export class MetrcLabTestRecordService {
  async record(input: MetrcLabTestRecordInput): Promise<MetrcLabTestRecordResponse> {
    const loaded = await loadCompanyMetrcConfig(input.companyId);
    if (!loaded) {
      return { ok: false, status: 404, message: "Company configuration not found." };
    }

    if (loaded.environment !== "sandbox") {
      return {
        ok: false,
        status: 403,
        message: "Record lab test result is sandbox-only. Switch METRC environment to sandbox.",
      };
    }

    if (!loaded.userApiKey) {
      return {
        ok: false,
        status: 400,
        message: "User API key is required. Run sandbox setup or save a user key in Company Config.",
      };
    }

    const packageLabel = String(input.packageLabel || "").trim();
    if (!packageLabel) {
      return { ok: false, status: 400, message: "Package label is required." };
    }

    const resultDate = String(input.resultDate || "").trim();
    if (!resultDate) {
      return { ok: false, status: 400, message: "Result date is required." };
    }

    const results = (input.results || [])
      .map((row) => ({
        LabTestTypeName: String(row.labTestTypeName || "").trim(),
        Quantity:
          typeof row.quantity === "number" && Number.isFinite(row.quantity) && row.quantity > 0
            ? row.quantity
            : 1,
        Passed: Boolean(row.passed),
        Notes: String(row.notes || "").trim() || null,
      }))
      .filter((row) => row.LabTestTypeName);

    if (results.length === 0) {
      return {
        ok: false,
        status: 400,
        message: "At least one lab result with a METRC lab test type name is required.",
      };
    }

    const licenseNumber = METRC_COLORADO_SANDBOX_LICENSE;
    const syncedPackage = await findMetrcPackageByLabel(input.companyId, packageLabel);
    const packageFacilityLicense = String(syncedPackage?.licenseNumber || "").trim() || null;
    const client = MetrcClient.fromLoadedConfig(loaded, input.companyId);
    const baseUrl =
      client.baseUrl ||
      resolveMetrcApiBaseUrl({
        environment: loaded.environment,
        stateCode: loaded.stateCode,
        apiBaseUrlOverride: loaded.apiBaseUrlOverride,
      }) ||
      "";

    const body = [
      {
        Label: packageLabel,
        ResultDate: resultDate,
        Results: results,
      },
    ];
    const pathname = `${LAB_TEST_RECORD_ENDPOINT}?licenseNumber=${encodeURIComponent(licenseNumber)}`;
    const startedAt = Date.now();
    const result = await client.post<unknown>(pathname, body);
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
      licenseNumber,
      authMode,
      baseUrl,
      payloadBody: body,
    });
    const requestPayload = { pathname, body, requestDebug };

    if (isMetrcClientFailure(result)) {
      const isAuthDenied = result.status === 401 || result.status === 403;
      const message =
        result.status === 401
          ? METRC_LAB_TEST_401_MESSAGE
          : isAuthDenied
            ? METRC_AUTH_PERMISSION_MESSAGE
            : metrcPullFailureMessage(result.status, result.metrcMessage || result.message);
      const authEvidence: MetrcLabTestRecordAuthEvidence | undefined = isAuthDenied
        ? {
            endpoint: LAB_TEST_RECORD_ENDPOINT,
            finalLicenseNumber: licenseNumber,
            authMode,
            baseUrl,
            exactPayload: body,
            selectedPackageLabel: packageLabel,
            packageFacilityLicense,
            labTestTypesSourceLicense: METRC_COLORADO_SANDBOX_LICENSE,
            sameAuthUsedByEndpoints: SAME_AUTH_COMPARABLE_LAB_TEST_ENDPOINTS,
          }
        : undefined;
      if (isAuthDenied) {
        logMetrcCredentialDiagnostics({
          companyId: input.companyId,
          purpose: "lab_test_record",
          userKeyLength: loaded.userApiKey.length,
          vendorKeyLength: loaded.vendorApiKey.length,
          licensePresent: true,
        });
      }
      logWarn("[METRC] lab_test_record_failed", {
        companyId: input.companyId,
        status: result.status,
        message,
        requestDebug,
        authEvidence,
      });
      return {
        ok: false,
        status: result.status,
        message,
        credentialHint: isAuthDenied ? buildMetrcCredentialHintFromLoaded(loaded) : undefined,
        endpoint: LAB_TEST_RECORD_ENDPOINT,
        requestPayload,
        requestDebug,
        authEvidence,
        responsePayload: result,
        metrcMessage: result.metrcMessage,
      };
    }

    logInfo("[METRC] lab_test_record_success", {
      companyId: input.companyId,
      packageLabel,
      status: result.status,
      durationMs,
      requestDebug,
    });

    return {
      ok: true,
      status: result.status,
      message: "Lab test result recorded in METRC sandbox.",
      endpoint: LAB_TEST_RECORD_ENDPOINT,
      requestPayload,
      requestDebug,
      responsePayload: result.data,
      durationMs,
    };
  }
}
