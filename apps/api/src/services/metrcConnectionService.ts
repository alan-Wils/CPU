import { ConfigService } from "./configService.js";
import { logInfo, logWarn } from "../lib/logger.js";
import { resolveMetrcApiBaseUrl } from "../lib/metrcResolveBaseUrl.js";
import {
  messageForMetrcHttpFailure,
  parseLocationsPayload,
  toSampleLocation,
} from "../lib/metrcConnectionHelpers.js";
import { buildMetrcAuthorization, isMetrcAuthorizationErr } from "../lib/metrcAuthHeaders.js";

export type MetrcTestConnectionSuccess = {
  ok: true;
  connected: true;
  checkedAt: string;
  baseUrl: string;
  licenseNumber: string;
  locationCount: number;
  sampleLocations: ReturnType<typeof toSampleLocation>[];
};

export type MetrcTestConnectionFailure = {
  ok: false;
  connected: false;
  checkedAt: string;
  status: number;
  message: string;
  baseUrl: string | null;
  licenseNumber: string;
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
      };
      await this.persistConnectionSnapshot(input.companyId, input.actorUserId, company, metrc, fail);
      return fail;
    }

    const auth = buildMetrcAuthorization(apiKey, userKey);
    if (isMetrcAuthorizationErr(auth)) {
      const fail: MetrcTestConnectionFailure = {
        ok: false,
        connected: false,
        checkedAt,
        status: auth.status,
        message: auth.message,
        baseUrl,
        licenseNumber,
      };
      await this.persistConnectionSnapshot(input.companyId, input.actorUserId, company, metrc, fail);
      return fail;
    }

    const url = `${baseUrl.replace(/\/+$/, "")}/locations/v2/active?licenseNumber=${encodeURIComponent(licenseNumber)}`;
    const hadVendorKey = Boolean(apiKey.trim());

    try {
      if (hadVendorKey) {
        logInfo("Using METRC dual-key auth", { companyId: input.companyId });
      } else {
        logInfo("Using METRC single-key fallback auth", { companyId: input.companyId });
      }

      let { res, bodyJson } = await fetchMetrcActiveLocationsOnce(url, auth.authorization);

      if (!res.ok && res.status === 401 && hadVendorKey) {
        logInfo("METRC dual-key rejected (401); retrying Bearer user key", { companyId: input.companyId });
        const second = await fetchMetrcActiveLocationsOnce(url, `Bearer ${userKey}`);
        res = second.res;
        bodyJson = second.bodyJson;
      }

      if (!res.ok && res.status === 401) {
        logInfo(
          hadVendorKey
            ? "METRC auth retry: Basic with empty integrator field"
            : "METRC Bearer rejected (401); retrying Basic with empty integrator field",
          { companyId: input.companyId },
        );
        const basicUserOnly = `Basic ${Buffer.from(`:${userKey}`, "utf8").toString("base64")}`;
        const third = await fetchMetrcActiveLocationsOnce(url, basicUserOnly);
        res = third.res;
        bodyJson = third.bodyJson;
      }

      const status = res.status;

      if (!res.ok) {
        const message = messageForMetrcHttpFailure(status);
        const fail: MetrcTestConnectionFailure = {
          ok: false,
          connected: false,
          checkedAt,
          status,
          message,
          baseUrl,
          licenseNumber,
        };
        logWarn("[METRC] connection_test_failed", {
          companyId: input.companyId,
          status,
        });
        await this.persistConnectionSnapshot(input.companyId, input.actorUserId, company, metrc, fail);
        return fail;
      }

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
      };
      logInfo("[METRC] connection_test_ok", {
        companyId: input.companyId,
        locationCount: locations.length,
      });
      await this.persistConnectionSnapshot(input.companyId, input.actorUserId, company, metrc, success);
      return success;
    } catch (error) {
      const fail: MetrcTestConnectionFailure = {
        ok: false,
        connected: false,
        checkedAt,
        status: 0,
        message: "Unable to reach METRC from the API server.",
        baseUrl,
        licenseNumber,
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
    } else {
      const fail = result as MetrcTestConnectionFailure;
      nextMetrc.metrcLastConnectionStatus = "not_connected";
      nextMetrc.metrcLastConnectionMessage = String(fail.message || "").slice(0, 4000);
      nextMetrc.metrcLastConnectionHttpStatus =
        typeof fail.status === "number" && Number.isFinite(fail.status) ? fail.status : null;
      nextMetrc.metrcLastLocationCount = null;
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
