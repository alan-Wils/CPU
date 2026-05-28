import { logInfo } from "../lib/logger.js";
import { parseMetrcPlantBatchWasteReasonNames } from "../lib/metrcConnectionHelpers.js";
import { isMetrcPerformGetFailure, performMetrcAuthorizedGet } from "../lib/metrcPerformGet.js";
import type { MetrcAttemptFailure } from "../lib/metrcConnectionAttempts.js";
import { loadCompanyMetrcConfig } from "../lib/metrcConfigLoader.js";
import { resolveMetrcApiBaseUrl } from "../lib/metrcResolveBaseUrl.js";

export type MetrcPlantBatchWasteReasonsSuccess = {
  ok: true;
  reasons: string[];
  parsedCount: number;
  licenseNumber: string;
  baseUrl: string;
  authMode: string;
  endpoint: string;
};

export type MetrcPlantBatchWasteReasonsFailure = {
  ok: false;
  status: number;
  message: string;
  baseUrl: string | null;
  licenseNumber: string;
  attemptedModes: string[];
  failures: MetrcAttemptFailure[];
  endpoint: string;
};

export type MetrcPlantBatchWasteReasonsResponse =
  | MetrcPlantBatchWasteReasonsSuccess
  | MetrcPlantBatchWasteReasonsFailure;

const WASTE_REASONS_ENDPOINT = "/plantbatches/v2/waste/reasons";

export class MetrcPlantBatchWasteReasonsService {
  async fetchWasteReasons(input: {
    companyId: string;
    licenseNumber?: string | null;
  }): Promise<MetrcPlantBatchWasteReasonsResponse> {
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
        endpoint: WASTE_REASONS_ENDPOINT,
      };
    }

    const licenseNumber = String(input.licenseNumber ?? loaded.licenseNumber ?? "").trim();
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
          "Missing METRC license or API base URL. Save Admin → METRC settings (license, state, or API URL override).",
        baseUrl: baseUrl || null,
        licenseNumber: licenseNumber || "",
        attemptedModes: [],
        failures: [],
        endpoint: WASTE_REASONS_ENDPOINT,
      };
    }

    if (!loaded.userApiKey) {
      return {
        ok: false,
        status: 400,
        message: "METRC user API key is required. Save facility keys in Admin → METRC.",
        baseUrl,
        licenseNumber,
        attemptedModes: [],
        failures: [],
        endpoint: WASTE_REASONS_ENDPOINT,
      };
    }

    const path = `${WASTE_REASONS_ENDPOINT}?licenseNumber=${encodeURIComponent(licenseNumber)}`;
    const inner = await performMetrcAuthorizedGet({
      companyId: input.companyId,
      pathnameAndQuery: path,
    });

    if (isMetrcPerformGetFailure(inner)) {
      return {
        ok: false,
        status: inner.status,
        message: inner.message,
        baseUrl: inner.baseUrl,
        licenseNumber: inner.licenseNumber,
        attemptedModes: inner.attemptedModes,
        failures: inner.failures,
        endpoint: WASTE_REASONS_ENDPOINT,
      };
    }

    const reasons = parseMetrcPlantBatchWasteReasonNames(inner.bodyJson);

    logInfo("[METRC] plant_batch_waste_reasons_ok", {
      companyId: input.companyId,
      parsedCount: reasons.length,
      authMode: inner.authMode,
    });

    return {
      ok: true,
      reasons,
      parsedCount: reasons.length,
      licenseNumber: inner.licenseNumber,
      baseUrl: inner.baseUrl,
      authMode: inner.authMode,
      endpoint: WASTE_REASONS_ENDPOINT,
    };
  }
}
