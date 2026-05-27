import { ConfigService } from "./configService.js";
import { logInfo } from "../lib/logger.js";
import { parsePlantTagLabelsFromAvailableResponse } from "../lib/metrcConnectionHelpers.js";
import { isMetrcPerformGetFailure, performMetrcAuthorizedGet } from "../lib/metrcPerformGet.js";
import type { MetrcAttemptFailure } from "../lib/metrcConnectionAttempts.js";
import { resolveMetrcApiBaseUrl } from "../lib/metrcResolveBaseUrl.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export type MetrcAvailablePackageTagsSuccess = {
  ok: true;
  labels: string[];
  parsedCount: number;
  totalReturned: number;
  licenseNumber: string;
  baseUrl: string;
  authMode: string;
};

export type MetrcAvailablePackageTagsFailure = {
  ok: false;
  status: number;
  message: string;
  baseUrl: string | null;
  licenseNumber: string;
  attemptedModes: string[];
  failures: MetrcAttemptFailure[];
};

export type MetrcAvailablePackageTagsResponse =
  | MetrcAvailablePackageTagsSuccess
  | MetrcAvailablePackageTagsFailure;

/**
 * GET /tags/v2/package/available — read-only optional helper for sandbox package tag entry.
 */
export class MetrcAvailablePackageTagsService {
  async fetchLabels(input: {
    companyId: string;
    limit: number;
    licenseNumber?: string | null;
  }): Promise<MetrcAvailablePackageTagsResponse> {
    const max = Math.min(500, Math.max(1, input.limit));
    const configService = new ConfigService();
    const rows = await configService.list(input.companyId);
    const companyRow = rows.find((r) => r.key === "company");
    const company = asRecord(companyRow?.value);
    const metrc = asRecord(company.metrc);
    const licenseNumber = String(input.licenseNumber ?? metrc.licenseNumber ?? "").trim();
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

    const path = `/tags/v2/package/available?licenseNumber=${encodeURIComponent(licenseNumber)}`;
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

    logInfo("[METRC] available_package_tags_ok", {
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
