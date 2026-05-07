import { ConfigService } from "./configService.js";
import { logInfo } from "../lib/logger.js";
import { isMetrcPerformGetFailure, performMetrcAuthorizedGet } from "../lib/metrcPerformGet.js";
import {
  resolveMetrcApiBaseUrl,
} from "../lib/metrcResolveBaseUrl.js";
import { parsePlantTagLabelsFromAvailableResponse } from "../lib/metrcConnectionHelpers.js";
import type { MetrcAttemptFailure, MetrcAuthModeUsed } from "../lib/metrcConnectionAttempts.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export type MetrcAvailablePlantTagsSuccess = {
  ok: true;
  labels: string[];
  /** Rows parsed from METRC before client `limit` cap */
  parsedCount: number;
  /** Same as labels.length — tags returned after cap */
  totalReturned: number;
  licenseNumber: string;
  baseUrl: string;
  authMode: MetrcAuthModeUsed;
};

export type MetrcAvailablePlantTagsFailure = {
  ok: false;
  status: number;
  message: string;
  baseUrl: string | null;
  licenseNumber: string;
  attemptedModes: MetrcAuthModeUsed[];
  failures: MetrcAttemptFailure[];
};

export type MetrcAvailablePlantTagsResponse =
  | MetrcAvailablePlantTagsSuccess
  | MetrcAvailablePlantTagsFailure;

/**
 * GET /tags/v2/plant/available — read-only; requires Tags permission on METRC side (often a premium endpoint).
 */
export class MetrcAvailablePlantTagsService {
  async fetchLabels(input: {
    companyId: string;
    limit: number;
  }): Promise<MetrcAvailablePlantTagsResponse> {
    const max = Math.min(500, Math.max(1, input.limit));
    const configService = new ConfigService();
    const rows = await configService.list(input.companyId);
    const companyRow = rows.find((r) => r.key === "company");
    const company = asRecord(companyRow?.value);
    const metrc = asRecord(company.metrc);
    const licenseNumber = String(metrc.licenseNumber || "").trim();
    const baseUrlPre = resolveMetrcApiBaseUrl({
      stateCode: String(metrc.stateCode || ""),
      environment: metrc.environment === "sandbox" ? "sandbox" : "production",
      apiBaseUrlOverride: String(metrc.apiBaseUrlOverride || ""),
    });
    const userKey = String(metrc.userKey || "").trim();

    if (!licenseNumber || !baseUrlPre) {
      return {
        ok: false,
        status: 400,
        message:
          "Missing METRC license or API base URL. Save Admin → METRC settings (license, state, or API URL override).",
        baseUrl: baseUrlPre,
        licenseNumber: licenseNumber || "",
        attemptedModes: [],
        failures: [],
      };
    }

    if (!userKey) {
      return {
        ok: false,
        status: 400,
        message: "METRC user API key is required. Save facility keys in Admin → METRC.",
        baseUrl: baseUrlPre,
        licenseNumber,
        attemptedModes: [],
        failures: [],
      };
    }

    const path = `/tags/v2/plant/available?licenseNumber=${encodeURIComponent(licenseNumber)}`;
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
      };
    }

    const parsed = parsePlantTagLabelsFromAvailableResponse(inner.bodyJson);
    const labels = parsed.slice(0, max);

    logInfo("[METRC] available_plant_tags_ok", {
      companyId: input.companyId,
      parsedCount: parsed.length,
      returnedCount: labels.length,
      authMode: inner.authMode,
    });

    return {
      ok: true,
      labels,
      parsedCount: parsed.length,
      totalReturned: labels.length,
      licenseNumber: inner.licenseNumber,
      baseUrl: inner.baseUrl,
      authMode: inner.authMode,
    };
  }
}
