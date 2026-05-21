import { ConfigService } from "./configService.js";
import { env } from "../config/env.js";
import { logInfo, logWarn } from "../lib/logger.js";
import {
  MetrcClient,
  isMetrcClientFailure,
  resolveSandboxIntegratorSetupUrl,
} from "../lib/metrcClient.js";
import { orderMetrcEndpointCandidates } from "../lib/metrcEndpoints.js";
import { loadCompanyMetrcConfig, readUserApiKey, readVendorApiKey } from "../lib/metrcConfigLoader.js";
import {
  buildMetrcSandboxSetupDebug,
  isMetrcSandboxAsyncProvisioningResponse,
  isMetrcSandboxPartialProvisioning,
  parseMetrcSandboxSetupResponse,
  redactMetrcSandboxPayload,
  type MetrcSandboxSetupDebugInfo,
  type MetrcSandboxSetupParsed,
} from "../lib/metrcSandboxSetupParse.js";

export const SANDBOX_PROVISIONING_MAX_MS = 5 * 60 * 1000;

export type MetrcSandboxLifecycleStatus =
  | "idle"
  | "provisioning"
  | "ready"
  | "timeout"
  | "error";

export type MetrcSandboxSetupSuccess = {
  ok: true;
  status: "ready";
  setupAt: string;
  facilityLicenseNumber: string;
  facilityName: string;
  username: string;
  hasUserApiKey: true;
  credentialsReady: boolean;
  debug?: MetrcSandboxSetupDebugInfo;
};

export type MetrcSandboxSetupProvisioning = {
  ok: true;
  status: "provisioning";
  message: string;
  provisioningStartedAt: string;
  facilityLicenseNumber?: string;
  facilityName?: string;
  username?: string;
};

export type MetrcSandboxSetupFailure = {
  ok: false;
  status: "error";
  httpStatus: number;
  message: string;
  debug?: MetrcSandboxSetupDebugInfo;
};

export type MetrcSandboxSetupResponse =
  | MetrcSandboxSetupSuccess
  | MetrcSandboxSetupProvisioning
  | MetrcSandboxSetupFailure;

export type MetrcSandboxStatusResponse = {
  ok: true;
  status: MetrcSandboxLifecycleStatus;
  sandboxProvisioning: boolean;
  sandboxReady: boolean;
  sandboxProvisioningStartedAt: string | null;
  hasMetrcVendorApiKey: boolean;
  hasMetrcUserApiKey: boolean;
  metrcLicenseNumberDisplay: string;
  metrcFacilityName: string;
  metrcUsernameDisplay: string;
  credentialsReady: boolean;
  message: string;
  elapsedMs: number | null;
  remainingMs: number | null;
};

function readProvisioningStartedAt(metrc: Record<string, unknown>): string | null {
  const raw = String(metrc.sandboxProvisioningStartedAt ?? "").trim();
  return raw || null;
}

function provisioningElapsedMs(startedAt: string | null): number | null {
  if (!startedAt) return null;
  const t = Date.parse(startedAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Date.now() - t);
}

function buildStatusMessage(
  lifecycle: MetrcSandboxLifecycleStatus,
  metrc: Record<string, unknown>,
): string {
  switch (lifecycle) {
    case "provisioning":
      return "METRC is creating your sandbox user…";
    case "ready":
      return "Sandbox ready";
    case "timeout":
      return "Sandbox user creation timed out after 5 minutes. Try Generate Sandbox Facility again.";
    case "error":
      return String(metrc.sandboxProvisioningLastError ?? "Sandbox provisioning failed.").slice(0, 500);
    default:
      return metrc.sandboxReady ? "Sandbox ready" : "Sandbox not provisioned";
  }
}

export class MetrcSandboxService {
  configService = new ConfigService();

  private async saveCompanyMetrc(
    companyId: string,
    actorUserId: string,
    company: Record<string, unknown>,
    metrc: Record<string, unknown>,
  ): Promise<void> {
    await this.configService.upsert({
      companyId,
      actorUserId,
      key: "company",
      value: { ...company, metrc },
    });
  }

  private buildCredentialsReady(
    vendorApiKey: string,
    userApiKey: string,
    licenseNumber: string,
  ): boolean {
    return Boolean(vendorApiKey && userApiKey && licenseNumber);
  }

  private applyCredentialsToMetrc(
    metrc: Record<string, unknown>,
    vendorApiKey: string,
    parsed: MetrcSandboxSetupParsed,
    stateCode: string,
  ): Record<string, unknown> {
    const licenseNumber =
      parsed.facilityLicenseNumber || String(metrc.licenseNumber || metrc.facilityLicenseNumber || "").trim();
    return {
      ...metrc,
      apiKey: vendorApiKey,
      userKey: parsed.userApiKey,
      userApiKey: parsed.userApiKey,
      licenseNumber,
      facilityLicenseNumber: licenseNumber,
      username: parsed.username || String(metrc.username || "").trim(),
      facilityName: parsed.facilityName || String(metrc.facilityName || "").trim(),
      environment: "sandbox",
      stateCode: stateCode.toUpperCase(),
      integrationEnabled: true,
      sandboxProvisioning: false,
      sandboxReady: this.buildCredentialsReady(vendorApiKey, parsed.userApiKey, licenseNumber),
      sandboxProvisioningLastError: "",
    };
  }

  private async markProvisioning(
    input: {
      companyId: string;
      actorUserId: string;
      loaded: NonNullable<Awaited<ReturnType<typeof loadCompanyMetrcConfig>>>;
      parsed?: MetrcSandboxSetupParsed;
      httpStatus?: number;
      metrcMessage?: string;
    },
  ): Promise<MetrcSandboxSetupProvisioning> {
    const startedAt = new Date().toISOString();
    const partial = input.parsed;
    const nextMetrc: Record<string, unknown> = {
      ...input.loaded.metrc,
      apiKey: input.loaded.vendorApiKey,
      environment: "sandbox",
      stateCode: (input.loaded.stateCode || "CO").toUpperCase(),
      integrationEnabled: true,
      sandboxProvisioning: true,
      sandboxReady: false,
      sandboxProvisioningStartedAt: startedAt,
      sandboxProvisioningLastError: "",
    };

    if (partial?.facilityLicenseNumber) {
      nextMetrc.licenseNumber = partial.facilityLicenseNumber;
      nextMetrc.facilityLicenseNumber = partial.facilityLicenseNumber;
    }
    if (partial?.facilityName) nextMetrc.facilityName = partial.facilityName;
    if (partial?.username) nextMetrc.username = partial.username;

    await this.saveCompanyMetrc(
      input.companyId,
      input.actorUserId,
      input.loaded.company,
      nextMetrc,
    );

    logInfo("[METRC] sandbox_provisioning_started", {
      companyId: input.companyId,
      httpStatus: input.httpStatus ?? null,
      metrcMessage: input.metrcMessage?.slice(0, 200) ?? null,
      hasPartialLicense: Boolean(partial?.facilityLicenseNumber),
      hasPartialFacilityName: Boolean(partial?.facilityName),
    });

    return {
      ok: true,
      status: "provisioning",
      message: "METRC is creating your sandbox user…",
      provisioningStartedAt: startedAt,
      facilityLicenseNumber: partial?.facilityLicenseNumber || undefined,
      facilityName: partial?.facilityName || undefined,
      username: partial?.username || undefined,
    };
  }

  /** Re-invoke setup and facilities lookup to discover async credentials. */
  private async tryDiscoverSandboxCredentials(
    companyId: string,
    loaded: NonNullable<Awaited<ReturnType<typeof loadCompanyMetrcConfig>>>,
  ): Promise<MetrcSandboxSetupParsed | null> {
    const vendorApiKey = loaded.vendorApiKey;
    const stateCode = loaded.stateCode || "CO";
    const setupUrl = resolveSandboxIntegratorSetupUrl(stateCode);
    if (!setupUrl || !vendorApiKey) return null;

    const client = MetrcClient.fromLoadedConfig(
      { ...loaded, userApiKey: "", username: "", licenseNumber: "" },
      companyId,
    );

    const setupResult = await client.request<unknown>({
      method: "POST",
      pathnameAndQuery: "/sandbox/v2/integrator/setup",
      absoluteUrl: setupUrl,
      body: {},
    });

    if (!isMetrcClientFailure(setupResult)) {
      if (isMetrcSandboxAsyncProvisioningResponse(setupResult.status, setupResult.data)) {
        return null;
      }
      const parsed = parseMetrcSandboxSetupResponse(setupResult.data, { vendorApiKey });
      if (parsed.userApiKey) return parsed;
    }

    const facilityPaths = orderMetrcEndpointCandidates(
      { stateCode, environment: loaded.environment },
      "facilities",
      "",
    );
    let facilitiesResult: Awaited<ReturnType<MetrcClient["request"]>> | null = null;
    for (let i = 0; i < facilityPaths.length; i += 1) {
      const pathname = facilityPaths[i]!;
      const attempt = await client.request<unknown>({
        method: "GET",
        pathnameAndQuery: pathname,
        vendorOnly: true,
      });
      if (!isMetrcClientFailure(attempt)) {
        facilitiesResult = attempt;
        break;
      }
      facilitiesResult = attempt;
      const tryNext =
        i < facilityPaths.length - 1
        && (attempt.upstreamError?.type === "html_runtime_error" || attempt.status === 404);
      if (!tryNext) break;
      logInfo("[METRC] sandbox_facilities_endpoint_fallback", {
        companyId,
        from: pathname.split("?")[0],
        next: facilityPaths[i + 1]?.split("?")[0] ?? null,
      });
    }

    if (facilitiesResult && !isMetrcClientFailure(facilitiesResult)) {
      const parsed = parseMetrcSandboxSetupResponse(facilitiesResult.data, { vendorApiKey });
      const existingUser = readUserApiKey(loaded.metrc);
      if (parsed.userApiKey) return parsed;
      if (existingUser && parsed.facilityLicenseNumber) {
        return {
          ...parsed,
          userApiKey: existingUser,
          parserPaths: { ...parsed.parserPaths, userApiKey: "config.userKey" },
          fieldsFound: [...new Set([...parsed.fieldsFound, "userApiKey"])],
        };
      }
    }

    const existingUser = readUserApiKey(loaded.metrc);
    const license = String(loaded.licenseNumber || "").trim();
    if (existingUser && license) {
      return {
        userApiKey: existingUser,
        facilityLicenseNumber: license,
        username: loaded.username,
        facilityName: loaded.facilityName,
        parserPaths: {
          userApiKey: "config.userKey",
          facilityLicenseNumber: "config.licenseNumber",
          username: loaded.username ? "config.username" : null,
          facilityName: loaded.facilityName ? "config.facilityName" : null,
        },
        fieldsFound: ["userApiKey", "facilityLicenseNumber"],
      };
    }

    return null;
  }

  async runSandboxSetup(input: {
    companyId: string;
    actorUserId: string;
  }): Promise<MetrcSandboxSetupResponse> {
    const loaded = await loadCompanyMetrcConfig(input.companyId);
    if (!loaded) {
      return { ok: false, status: "error", httpStatus: 404, message: "Company configuration not found." };
    }

    const vendorApiKey = loaded.vendorApiKey;
    if (!vendorApiKey) {
      return {
        ok: false,
        status: "error",
        httpStatus: 400,
        message: "Vendor API key is required. Save your METRC integrator (vendor) key in Company Config first.",
      };
    }

    const stateCode = loaded.stateCode || "CO";
    const setupUrl = resolveSandboxIntegratorSetupUrl(stateCode);
    if (!setupUrl) {
      return {
        ok: false,
        status: "error",
        httpStatus: 400,
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
      });
      return { ok: false, status: "error", httpStatus: result.status || 502, message: result.message };
    }

    const parsed = parseMetrcSandboxSetupResponse(result.data, { vendorApiKey });
    const debug = buildMetrcSandboxSetupDebug(result.data, parsed);
    const devMode = env.NODE_ENV === "development";
    const metrcMessage = typeof result.data === "string" ? result.data : "";

    logInfo("[METRC] sandbox_setup_response_shape", {
      companyId: input.companyId,
      httpStatus: result.status,
      topLevelKeys: debug.topLevelKeys,
      fieldsFound: parsed.fieldsFound,
      parserPaths: parsed.parserPaths,
      hasUserApiKey: Boolean(parsed.userApiKey),
      asyncProvisioning: isMetrcSandboxAsyncProvisioningResponse(result.status, result.data),
      redactedPayload: redactMetrcSandboxPayload(result.data),
    });

    if (
      isMetrcSandboxPartialProvisioning(parsed, result.status, result.data)
    ) {
      return this.markProvisioning({
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        loaded,
        parsed,
        httpStatus: result.status,
        metrcMessage,
      });
    }

    if (!parsed.userApiKey) {
      return {
        ok: false,
        status: "error",
        httpStatus: 502,
        message:
          "Sandbox setup completed without a user API key. Check server logs for [METRC] sandbox_setup_response_shape.",
        ...(devMode ? { debug } : {}),
      };
    }

    const setupAt = new Date().toISOString();
    const nextMetrc = this.applyCredentialsToMetrc(
      loaded.metrc,
      vendorApiKey,
      parsed,
      stateCode,
    );

    await this.saveCompanyMetrc(input.companyId, input.actorUserId, loaded.company, nextMetrc);

    const licenseNumber = String(nextMetrc.licenseNumber || "").trim();
    const credentialsReady = this.buildCredentialsReady(vendorApiKey, parsed.userApiKey, licenseNumber);

    logInfo("[METRC] sandbox_ready", {
      companyId: input.companyId,
      licenseNumber,
      facilityName: parsed.facilityName,
      userApiKeyParserPath: parsed.parserPaths.userApiKey,
      credentialsReady,
      immediate: true,
    });

    return {
      ok: true,
      status: "ready",
      setupAt,
      facilityLicenseNumber: licenseNumber,
      facilityName: parsed.facilityName,
      username: parsed.username,
      hasUserApiKey: true,
      credentialsReady,
      ...(devMode ? { debug } : {}),
    };
  }

  async pollSandboxStatus(input: {
    companyId: string;
    actorUserId: string;
  }): Promise<MetrcSandboxStatusResponse> {
    const loaded = await loadCompanyMetrcConfig(input.companyId);
    if (!loaded) {
      return {
        ok: true,
        status: "error",
        sandboxProvisioning: false,
        sandboxReady: false,
        sandboxProvisioningStartedAt: null,
        hasMetrcVendorApiKey: false,
        hasMetrcUserApiKey: false,
        metrcLicenseNumberDisplay: "",
        metrcFacilityName: "",
        metrcUsernameDisplay: "",
        credentialsReady: false,
        message: "Company configuration not found.",
        elapsedMs: null,
        remainingMs: null,
      };
    }

    const metrc = loaded.metrc;
    const vendorApiKey = loaded.vendorApiKey;
    const userApiKey = readUserApiKey(metrc);
    const licenseNumber = loaded.licenseNumber;
    const credentialsReady = this.buildCredentialsReady(vendorApiKey, userApiKey, licenseNumber);
    const startedAt = readProvisioningStartedAt(metrc);
    const elapsedMs = provisioningElapsedMs(startedAt);
    const remainingMs =
      elapsedMs != null ? Math.max(0, SANDBOX_PROVISIONING_MAX_MS - elapsedMs) : null;

    if (credentialsReady || metrc.sandboxReady === true) {
      if (metrc.sandboxProvisioning) {
        const cleared = {
          ...metrc,
          sandboxProvisioning: false,
          sandboxReady: true,
        };
        await this.saveCompanyMetrc(input.companyId, input.actorUserId, loaded.company, cleared);
      }
      return {
        ok: true,
        status: "ready",
        sandboxProvisioning: false,
        sandboxReady: true,
        sandboxProvisioningStartedAt: startedAt,
        hasMetrcVendorApiKey: Boolean(vendorApiKey),
        hasMetrcUserApiKey: Boolean(userApiKey),
        metrcLicenseNumberDisplay: licenseNumber,
        metrcFacilityName: loaded.facilityName,
        metrcUsernameDisplay: loaded.username,
        credentialsReady: true,
        message: "Sandbox ready",
        elapsedMs,
        remainingMs,
      };
    }

    if (!metrc.sandboxProvisioning) {
      return {
        ok: true,
        status: "idle",
        sandboxProvisioning: false,
        sandboxReady: false,
        sandboxProvisioningStartedAt: null,
        hasMetrcVendorApiKey: Boolean(vendorApiKey),
        hasMetrcUserApiKey: Boolean(userApiKey),
        metrcLicenseNumberDisplay: licenseNumber,
        metrcFacilityName: loaded.facilityName,
        metrcUsernameDisplay: loaded.username,
        credentialsReady: false,
        message: "Sandbox not provisioned",
        elapsedMs: null,
        remainingMs: null,
      };
    }

    if (elapsedMs != null && elapsedMs >= SANDBOX_PROVISIONING_MAX_MS) {
      const timedOut = {
        ...metrc,
        sandboxProvisioning: false,
        sandboxReady: false,
        sandboxProvisioningLastError: "Provisioning timed out after 5 minutes.",
      };
      await this.saveCompanyMetrc(input.companyId, input.actorUserId, loaded.company, timedOut);
      logWarn("[METRC] sandbox_provisioning_timeout", {
        companyId: input.companyId,
        elapsedMs,
      });
      return {
        ok: true,
        status: "timeout",
        sandboxProvisioning: false,
        sandboxReady: false,
        sandboxProvisioningStartedAt: startedAt,
        hasMetrcVendorApiKey: Boolean(vendorApiKey),
        hasMetrcUserApiKey: Boolean(userApiKey),
        metrcLicenseNumberDisplay: licenseNumber,
        metrcFacilityName: loaded.facilityName,
        metrcUsernameDisplay: loaded.username,
        credentialsReady: false,
        message: buildStatusMessage("timeout", timedOut),
        elapsedMs,
        remainingMs: 0,
      };
    }

    logInfo("[METRC] sandbox_provisioning_poll", {
      companyId: input.companyId,
      elapsedMs,
      remainingMs,
    });

    const discovered = await this.tryDiscoverSandboxCredentials(input.companyId, loaded);

    if (discovered?.userApiKey) {
      const stateCode = loaded.stateCode || "CO";
      const nextMetrc = this.applyCredentialsToMetrc(metrc, vendorApiKey, discovered, stateCode);
      await this.saveCompanyMetrc(input.companyId, input.actorUserId, loaded.company, nextMetrc);

      const lic = String(nextMetrc.licenseNumber || "").trim();

      logInfo("[METRC] sandbox_ready", {
        companyId: input.companyId,
        licenseNumber: lic,
        facilityName: discovered.facilityName,
        userApiKeyParserPath: discovered.parserPaths.userApiKey,
        elapsedMs,
        polled: true,
      });

      return {
        ok: true,
        status: "ready",
        sandboxProvisioning: false,
        sandboxReady: true,
        sandboxProvisioningStartedAt: startedAt,
        hasMetrcVendorApiKey: Boolean(vendorApiKey),
        hasMetrcUserApiKey: true,
        metrcLicenseNumberDisplay: lic,
        metrcFacilityName: String(nextMetrc.facilityName || "").trim(),
        metrcUsernameDisplay: String(nextMetrc.username || "").trim(),
        credentialsReady: true,
        message: "Sandbox ready",
        elapsedMs,
        remainingMs,
      };
    }

    return {
      ok: true,
      status: "provisioning",
      sandboxProvisioning: true,
      sandboxReady: false,
      sandboxProvisioningStartedAt: startedAt,
      hasMetrcVendorApiKey: Boolean(vendorApiKey),
      hasMetrcUserApiKey: Boolean(userApiKey),
      metrcLicenseNumberDisplay: licenseNumber,
      metrcFacilityName: loaded.facilityName,
      metrcUsernameDisplay: loaded.username,
      credentialsReady: false,
      message: buildStatusMessage("provisioning", metrc),
      elapsedMs,
      remainingMs,
    };
  }
}

/** Re-export for tests */
export { readVendorApiKey, readUserApiKey };
