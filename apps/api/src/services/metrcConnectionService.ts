import { ConfigService } from "./configService.js";
import { logWarn } from "../lib/logger.js";
import { isMetrcPerformGetFailure, performMetrcAuthorizedGet } from "../lib/metrcPerformGet.js";
import { resolveMetrcApiBaseUrl } from "../lib/metrcResolveBaseUrl.js";
import type { MetrcAttemptFailure, MetrcAuthModeUsed } from "../lib/metrcConnectionAttempts.js";
import { parseLocationsPayload, toSampleLocation } from "../lib/metrcConnectionHelpers.js";

export type MetrcTestConnectionSuccess = {
  ok: true;
  connected: true;
  checkedAt: string;
  baseUrl: string;
  licenseNumber: string;
  locationCount: number;
  sampleLocations: ReturnType<typeof toSampleLocation>[];
  authMode: MetrcAuthModeUsed;
};

export type MetrcTestConnectionFailure = {
  ok: false;
  connected: false;
  checkedAt: string;
  /** HTTP status from the last attempt */
  status: number;
  message: string;
  baseUrl: string | null;
  licenseNumber: string;
  attemptedModes: MetrcAuthModeUsed[];
  failures: MetrcAttemptFailure[];
};

export type MetrcTestConnectionResponse = MetrcTestConnectionSuccess | MetrcTestConnectionFailure;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export class MetrcConnectionService {
  configService = new ConfigService();

  async runTestConnection(input: {
    companyId: string;
    actorUserId: string;
  }): Promise<MetrcTestConnectionResponse> {
    const checkedAt = new Date().toISOString();
    const rows = await this.configService.list(input.companyId);
    const companyRow = rows.find((r) => r.key === "company");
    const company = asRecord(companyRow?.value);
    const metrc = asRecord(company.metrc);

    const baseUrl = resolveMetrcApiBaseUrl({
      stateCode: String(metrc.stateCode || ""),
      environment: metrc.environment === "sandbox" ? "sandbox" : "production",
      apiBaseUrlOverride: String(metrc.apiBaseUrlOverride || ""),
    });
    const licenseNumber = String(metrc.licenseNumber || "").trim();
    const userKey = String(metrc.userKey || "").trim();

    if (!baseUrl || !licenseNumber) {
      const fail: MetrcTestConnectionFailure = {
        ok: false,
        connected: false,
        checkedAt,
        status: 400,
        message: "Bad request. Check license number, state, and base URL. Save settings before testing.",
        baseUrl: baseUrl || null,
        licenseNumber: licenseNumber || "",
        attemptedModes: [],
        failures: [],
      };
      await this.persistConnectionSnapshot(input.companyId, input.actorUserId, company, metrc, fail);
      return fail;
    }

    if (!userKey) {
      const fail: MetrcTestConnectionFailure = {
        ok: false,
        connected: false,
        checkedAt,
        status: 400,
        message: "User API key is required. Save a facility user key before testing.",
        baseUrl,
        licenseNumber,
        attemptedModes: [],
        failures: [],
      };
      await this.persistConnectionSnapshot(input.companyId, input.actorUserId, company, metrc, fail);
      return fail;
    }

    const path = `/locations/v2/active?licenseNumber=${encodeURIComponent(licenseNumber)}`;

    const result = await performMetrcAuthorizedGet({
      companyId: input.companyId,
      pathnameAndQuery: path,
    });

    if (!isMetrcPerformGetFailure(result)) {
      const locations = parseLocationsPayload(result.bodyJson);
      const sampleLocations = locations.slice(0, 5).map(toSampleLocation);
      const success: MetrcTestConnectionSuccess = {
        ok: true,
        connected: true,
        checkedAt,
        baseUrl: result.baseUrl,
        licenseNumber: result.licenseNumber,
        locationCount: locations.length,
        sampleLocations,
        authMode: result.authMode,
      };
      await this.persistConnectionSnapshot(input.companyId, input.actorUserId, company, metrc, success);
      return success;
    }

    const fail: MetrcTestConnectionFailure = {
      ok: false,
      connected: false,
      checkedAt,
      status: result.status,
      message: result.message,
      baseUrl: result.baseUrl,
      licenseNumber: result.licenseNumber,
      attemptedModes: result.attemptedModes,
      failures: result.failures,
    };
    if (result.failures.length) {
      logWarn("[METRC] connection_test_failed_all_modes", {
        companyId: input.companyId,
        attemptCount: result.failures.length,
        lastStatus: result.status,
      });
    }
    await this.persistConnectionSnapshot(input.companyId, input.actorUserId, company, metrc, fail);
    return fail;
  }

  private async persistConnectionSnapshot(
    companyId: string,
    actorUserId: string,
    company: Record<string, unknown>,
    metrc: Record<string, unknown>,
    result: MetrcTestConnectionResponse,
  ): Promise<void> {
    const nextMetrc: Record<string, unknown> = { ...metrc };
    nextMetrc.metrcLastConnectionCheckedAt = result.checkedAt;

    if (result.ok && result.connected) {
      nextMetrc.metrcLastConnectionStatus = "connected";
      nextMetrc.metrcLastConnectionMessage = "";
      nextMetrc.metrcLastConnectionHttpStatus = null;
      nextMetrc.metrcLastLocationCount = result.locationCount;
      nextMetrc.metrcLastSuccessfulAuthMode = result.authMode;
    } else {
      const fail = result as MetrcTestConnectionFailure;
      nextMetrc.metrcLastConnectionStatus = "not_connected";
      nextMetrc.metrcLastConnectionMessage = String(fail.message || "").slice(0, 4000);
      nextMetrc.metrcLastConnectionHttpStatus =
        typeof fail.status === "number" && Number.isFinite(fail.status) ? fail.status : null;
      nextMetrc.metrcLastLocationCount = null;
      nextMetrc.metrcLastSuccessfulAuthMode = null;
    }

    const nextCompany = { ...company, metrc: nextMetrc };
    await this.configService.upsert({
      companyId,
      actorUserId,
      key: "company",
      value: nextCompany,
    });
  }
}
