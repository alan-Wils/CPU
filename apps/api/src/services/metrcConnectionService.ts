import { ConfigService } from "./configService.js";
import { logInfo, logWarn } from "../lib/logger.js";
import { resolveMetrcApiBaseUrl } from "../lib/metrcResolveBaseUrl.js";
import {
  buildAuthorizationHeader,
  buildMetrcAttemptPlan,
  type MetrcAttemptFailure,
  type MetrcAuthModeUsed,
} from "../lib/metrcConnectionAttempts.js";
import {
  extractMetrcApiErrorSummary,
  parseLocationsPayload,
  toSampleLocation,
} from "../lib/metrcConnectionHelpers.js";

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

async function fetchMetrcActiveLocationsOnce(
  url: string,
  authorization: string,
): Promise<{ res: Response; bodyText: string; bodyJson: unknown }> {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: authorization,
      Accept: "application/json",
      "User-Agent": "CPU-Platform/1.0",
    },
    signal: AbortSignal.timeout(25_000),
  });
  let bodyText = "";
  try {
    bodyText = await res.text();
  } catch {
    bodyText = "";
  }
  let bodyJson: unknown = null;
  try {
    bodyJson = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    bodyJson = null;
  }
  return { res, bodyText, bodyJson };
}

function summarizeAllAttemptsFailed(failures: MetrcAttemptFailure[]): string {
  if (!failures.length) return "METRC connection test failed.";
  const last = failures[failures.length - 1];
  const modes = failures.map((f) => f.mode).join(", ");
  const snippet = last.metrcSnippet ? ` ${last.metrcSnippet}` : "";
  return `Every auth mode failed (${modes}). Last: HTTP ${last.status}.${snippet}`.slice(0, 4000);
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
    const apiKey = String(metrc.apiKey || "").trim();
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

    const url = `${baseUrl.replace(/\/+$/, "")}/locations/v2/active?licenseNumber=${encodeURIComponent(licenseNumber)}`;
    const hasVendorKey = Boolean(apiKey);

    try {
      const plan = buildMetrcAttemptPlan(hasVendorKey);
      const failures: MetrcAttemptFailure[] = [];
      const attemptedModes: MetrcAuthModeUsed[] = [];

      for (const mode of plan) {
        const authorization = buildAuthorizationHeader(mode, apiKey, userKey);
        if (!authorization) {
          continue;
        }

        attemptedModes.push(mode);
        const t0 = Date.now();
        const { res, bodyText, bodyJson } = await fetchMetrcActiveLocationsOnce(url, authorization);
        const durationMs = Math.max(0, Date.now() - t0);
        const metrcSnippet = extractMetrcApiErrorSummary(bodyJson, bodyText);

        logInfo("[METRC] connection_attempt", {
          companyId: input.companyId,
          mode,
          status: res.status,
          durationMs,
          metrcSnippetPresent: Boolean(metrcSnippet),
        });

        if (res.ok) {
          const locations = parseLocationsPayload(bodyJson);
          const sampleLocations = locations.slice(0, 5).map(toSampleLocation);
          const success: MetrcTestConnectionSuccess = {
            ok: true,
            connected: true,
            checkedAt,
            baseUrl,
            licenseNumber,
            locationCount: locations.length,
            sampleLocations,
            authMode: mode,
          };
          logInfo("[METRC] connection_test_ok", {
            companyId: input.companyId,
            authMode: mode,
            locationCount: locations.length,
            attemptsBeforeSuccess: failures.length + 1,
          });
          await this.persistConnectionSnapshot(input.companyId, input.actorUserId, company, metrc, success);
          return success;
        }

        failures.push({
          mode,
          status: res.status,
          durationMs,
          metrcSnippet,
        });
      }

      const last = failures[failures.length - 1];
      const status = last?.status ?? 0;
      const fail: MetrcTestConnectionFailure = {
        ok: false,
        connected: false,
        checkedAt,
        status,
        message: summarizeAllAttemptsFailed(failures),
        baseUrl,
        licenseNumber,
        attemptedModes,
        failures,
      };
      logWarn("[METRC] connection_test_failed_all_modes", {
        companyId: input.companyId,
        attemptCount: failures.length,
        lastStatus: status,
      });
      await this.persistConnectionSnapshot(input.companyId, input.actorUserId, company, metrc, fail);
      return fail;
    } catch (error) {
      const fail: MetrcTestConnectionFailure = {
        ok: false,
        connected: false,
        checkedAt,
        status: 0,
        message: "Unable to reach METRC from the API server.",
        baseUrl,
        licenseNumber,
        attemptedModes: [],
        failures: [],
      };
      logWarn("[METRC] connection_test_error", {
        companyId: input.companyId,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.persistConnectionSnapshot(input.companyId, input.actorUserId, company, metrc, fail);
      return fail;
    }
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
