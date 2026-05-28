import { logInfo } from "../lib/logger.js";
import { parseMetrcLabTestTypeNames } from "../lib/metrcConnectionHelpers.js";
import { isMetrcPerformGetFailure, performMetrcAuthorizedGet } from "../lib/metrcPerformGet.js";
import type { MetrcAttemptFailure } from "../lib/metrcConnectionAttempts.js";
import { loadCompanyMetrcConfig } from "../lib/metrcConfigLoader.js";
import { resolveMetrcApiBaseUrl } from "../lib/metrcResolveBaseUrl.js";

export const METRC_COLORADO_SANDBOX_LICENSE = "SF-SBX-CO-7-13402";
const LAB_TEST_TYPES_ENDPOINT = "/labtests/v2/types";

export type MetrcLabTestTypesSuccess = {
  ok: true;
  labTestTypes: string[];
  parsedCount: number;
  licenseNumber: string;
  baseUrl: string;
  authMode: string;
  endpoint: string;
};

export type MetrcLabTestTypesFailure = {
  ok: false;
  status: number;
  message: string;
  baseUrl: string | null;
  licenseNumber: string;
  attemptedModes: string[];
  failures: MetrcAttemptFailure[];
  endpoint: string;
};

export type MetrcLabTestTypesResponse = MetrcLabTestTypesSuccess | MetrcLabTestTypesFailure;

export class MetrcLabTestTypesService {
  async fetchLabTestTypes(input: {
    companyId: string;
    licenseNumber?: string | null;
  }): Promise<MetrcLabTestTypesResponse> {
    const loaded = await loadCompanyMetrcConfig(input.companyId);
    if (!loaded) {
      return {
        ok: false,
        status: 404,
        message: "Company configuration not found.",
        baseUrl: null,
        licenseNumber: "",
        attemptedModes: [],
        failures: [],
        endpoint: LAB_TEST_TYPES_ENDPOINT,
      };
    }

    const licenseNumber = String(input.licenseNumber || METRC_COLORADO_SANDBOX_LICENSE).trim();
    const baseUrl =
      resolveMetrcApiBaseUrl({
        environment: loaded.environment,
        stateCode: loaded.stateCode,
        apiBaseUrlOverride: loaded.apiBaseUrlOverride,
      }) || "";

    if (!licenseNumber || !baseUrl) {
      return {
        ok: false,
        status: 400,
        message:
          "Missing METRC license or API base URL. Save Admin -> METRC settings (license, state, or API URL override).",
        baseUrl: baseUrl || null,
        licenseNumber: licenseNumber || "",
        attemptedModes: [],
        failures: [],
        endpoint: LAB_TEST_TYPES_ENDPOINT,
      };
    }

    if (!loaded.userApiKey) {
      return {
        ok: false,
        status: 400,
        message: "METRC user API key is required. Save facility keys in Admin -> METRC.",
        baseUrl,
        licenseNumber,
        attemptedModes: [],
        failures: [],
        endpoint: LAB_TEST_TYPES_ENDPOINT,
      };
    }

    const path = `${LAB_TEST_TYPES_ENDPOINT}?licenseNumber=${encodeURIComponent(licenseNumber)}`;
    const result = await performMetrcAuthorizedGet({
      companyId: input.companyId,
      pathnameAndQuery: path,
    });

    if (isMetrcPerformGetFailure(result)) {
      return {
        ok: false,
        status: result.status,
        message: result.message,
        baseUrl: result.baseUrl,
        licenseNumber: result.licenseNumber,
        attemptedModes: result.attemptedModes,
        failures: result.failures,
        endpoint: LAB_TEST_TYPES_ENDPOINT,
      };
    }

    const labTestTypes = parseMetrcLabTestTypeNames(result.bodyJson);

    logInfo("[METRC] lab_test_types_ok", {
      companyId: input.companyId,
      parsedCount: labTestTypes.length,
      authMode: result.authMode,
      endpoint: LAB_TEST_TYPES_ENDPOINT,
    });

    return {
      ok: true,
      labTestTypes,
      parsedCount: labTestTypes.length,
      licenseNumber: result.licenseNumber,
      baseUrl: result.baseUrl,
      authMode: result.authMode,
      endpoint: LAB_TEST_TYPES_ENDPOINT,
    };
  }
}
