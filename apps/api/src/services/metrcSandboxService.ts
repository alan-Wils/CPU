import { ConfigService } from "./configService.js";
import { env } from "../config/env.js";
import { logInfo, logWarn } from "../lib/logger.js";
import {
  MetrcClient,
  isMetrcClientFailure,
  resolveSandboxIntegratorSetupUrl,
} from "../lib/metrcClient.js";
import { loadCompanyMetrcConfig, readUserApiKey, readVendorApiKey } from "../lib/metrcConfigLoader.js";
import {
  buildMetrcSandboxSetupDebug,
  parseMetrcSandboxSetupResponse,
  redactMetrcSandboxPayload,
  type MetrcSandboxSetupDebugInfo,
} from "../lib/metrcSandboxSetupParse.js";

export type MetrcSandboxSetupSuccess = {
  ok: true;
  setupAt: string;
  facilityLicenseNumber: string;
  facilityName: string;
  username: string;
  hasUserApiKey: boolean;
  /** True when vendor key, user key, and license are all stored. */
  credentialsReady: boolean;
  debug?: MetrcSandboxSetupDebugInfo;
};

export type MetrcSandboxSetupFailure = {
  ok: false;
  status: number;
  message: string;
  debug?: MetrcSandboxSetupDebugInfo;
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

    const parsed = parseMetrcSandboxSetupResponse(result.data, { vendorApiKey });
    const debug = buildMetrcSandboxSetupDebug(result.data, parsed);
    const devMode = env.NODE_ENV === "development";

    logInfo("[METRC] sandbox_setup_response_shape", {
      companyId: input.companyId,
      topLevelKeys: debug.topLevelKeys,
      fieldsFound: parsed.fieldsFound,
      parserPaths: parsed.parserPaths,
      hasUserApiKey: Boolean(parsed.userApiKey),
      redactedPayload: redactMetrcSandboxPayload(result.data),
      structureOutline: debug.structureOutline,
    });

    if (!parsed.userApiKey) {
      logWarn("[METRC] sandbox_setup_missing_user_key", {
        companyId: input.companyId,
        topLevelKeys: debug.topLevelKeys,
        parserPaths: parsed.parserPaths,
        fieldsFound: parsed.fieldsFound,
      });
      return {
        ok: false,
        status: 502,
        message:
          "Sandbox setup returned facility details but no user API key. Check server logs for [METRC] sandbox_setup_response_shape (development responses include parser debug).",
        ...(devMode ? { debug } : {}),
      };
    }

    const setupAt = new Date().toISOString();
    const licenseNumber = parsed.facilityLicenseNumber || loaded.licenseNumber;
    const nextMetrc: Record<string, unknown> = {
      ...loaded.metrc,
      apiKey: vendorApiKey,
      userKey: parsed.userApiKey,
      userApiKey: parsed.userApiKey,
      licenseNumber,
      facilityLicenseNumber: licenseNumber,
      username: parsed.username,
      facilityName: parsed.facilityName || loaded.facilityName,
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

    const credentialsReady = Boolean(vendorApiKey && parsed.userApiKey && licenseNumber);

    logInfo("[METRC] sandbox_setup_ok", {
      companyId: input.companyId,
      licenseNumber,
      facilityName: parsed.facilityName,
      username: parsed.username,
      userApiKeyParserPath: parsed.parserPaths.userApiKey,
      credentialsReady,
      durationMs: result.durationMs,
      retries: result.retries,
    });

    return {
      ok: true,
      setupAt,
      facilityLicenseNumber: licenseNumber,
      facilityName: parsed.facilityName,
      username: parsed.username,
      hasUserApiKey: true,
      credentialsReady,
      ...(devMode ? { debug } : {}),
    };
  }
}

/** Re-export for tests */
export { readVendorApiKey, readUserApiKey };
