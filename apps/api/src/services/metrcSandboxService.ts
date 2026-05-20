import { ConfigService } from "./configService.js";
import { logInfo, logWarn } from "../lib/logger.js";
import {
  MetrcClient,
  isMetrcClientFailure,
  resolveSandboxIntegratorSetupUrl,
} from "../lib/metrcClient.js";
import { loadCompanyMetrcConfig, readUserApiKey, readVendorApiKey } from "../lib/metrcConfigLoader.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function pickSetupFields(body: unknown): {
  userApiKey: string;
  facilityLicenseNumber: string;
  username: string;
  facilityName: string;
} {
  const root = asRecord(body);
  const data = asRecord(root.Data ?? root.data);
  const src = Object.keys(data).length ? data : root;
  return {
    userApiKey: String(
      src.userApiKey ?? src.UserApiKey ?? src.userKey ?? src.UserKey ?? "",
    ).trim(),
    facilityLicenseNumber: String(
      src.facilityLicenseNumber
        ?? src.FacilityLicenseNumber
        ?? src.licenseNumber
        ?? src.LicenseNumber
        ?? "",
    ).trim(),
    username: String(src.username ?? src.Username ?? "").trim(),
    facilityName: String(src.facilityName ?? src.FacilityName ?? "").trim(),
  };
}

export type MetrcSandboxSetupSuccess = {
  ok: true;
  setupAt: string;
  facilityLicenseNumber: string;
  facilityName: string;
  username: string;
  hasUserApiKey: true;
};

export type MetrcSandboxSetupFailure = {
  ok: false;
  status: number;
  message: string;
};

export type MetrcSandboxSetupResponse = MetrcSandboxSetupSuccess | MetrcSandboxSetupFailure;

export class MetrcSandboxService {
  configService = new ConfigService();

  async runSandboxSetup(input: {
    companyId: string;
    actorUserId: string;
  }): Promise<MetrcSandboxSetupResponse> {
    const loaded = await loadCompanyMetrcConfig(input.companyId);
    if (!loaded) {
      return { ok: false, status: 404, message: "Company configuration not found." };
    }

    const vendorApiKey = loaded.vendorApiKey;
    if (!vendorApiKey) {
      return {
        ok: false,
        status: 400,
        message: "Vendor API key is required. Save your METRC integrator (vendor) key in Company Config first.",
      };
    }

    const stateCode = loaded.stateCode || "CO";
    const setupUrl = resolveSandboxIntegratorSetupUrl(stateCode);
    if (!setupUrl) {
      return {
        ok: false,
        status: 400,
        message: "Invalid state code for sandbox setup. Set a two-letter state (e.g. CO) in METRC settings.",
      };
    }

    const client = MetrcClient.fromLoadedConfig(
      { ...loaded, userApiKey: "", username: "", licenseNumber: "" },
      input.companyId,
    );

    logInfo("[METRC] sandbox_setup_start", {
      companyId: input.companyId,
      stateCode,
    });

    const result = await client.request<unknown>({
      method: "POST",
      pathnameAndQuery: "/sandbox/v2/integrator/setup",
      absoluteUrl: setupUrl,
      body: {},
    });

    if (isMetrcClientFailure(result)) {
      logWarn("[METRC] sandbox_setup_failed", {
        companyId: input.companyId,
        status: result.status,
        retries: result.retries,
        rateLimitWaitedMs: result.rateLimitWaitedMs,
      });
      return { ok: false, status: result.status || 502, message: result.message };
    }

    const fields = pickSetupFields(result.data);
    if (!fields.userApiKey) {
      return {
        ok: false,
        status: 502,
        message: "Sandbox setup succeeded but no user API key was returned. Check METRC sandbox response format.",
      };
    }

    const setupAt = new Date().toISOString();
    const nextMetrc: Record<string, unknown> = {
      ...loaded.metrc,
      apiKey: vendorApiKey,
      userKey: fields.userApiKey,
      licenseNumber: fields.facilityLicenseNumber || loaded.licenseNumber,
      username: fields.username,
      facilityName: fields.facilityName || loaded.facilityName,
      environment: "sandbox",
      stateCode: stateCode.toUpperCase(),
      integrationEnabled: true,
      metrcSandboxLastRateLimitWarning:
        result.rateLimitWaitedMs > 0
          ? `Rate limiter delayed requests by ${result.rateLimitWaitedMs}ms during setup.`
          : "",
    };

    const nextCompany = { ...loaded.company, metrc: nextMetrc };
    await this.configService.upsert({
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      key: "company",
      value: nextCompany,
    });

    logInfo("[METRC] sandbox_setup_ok", {
      companyId: input.companyId,
      licenseNumber: fields.facilityLicenseNumber,
      durationMs: result.durationMs,
      retries: result.retries,
    });

    return {
      ok: true,
      setupAt,
      facilityLicenseNumber: fields.facilityLicenseNumber,
      facilityName: fields.facilityName,
      username: fields.username,
      hasUserApiKey: true,
    };
  }
}

/** Re-export for tests */
export { readVendorApiKey, readUserApiKey };
