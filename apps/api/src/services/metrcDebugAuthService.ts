import { env } from "../config/env.js";
import { logInfo } from "../lib/logger.js";
import { MetrcClient, shouldTryNextMetrcAuthMode } from "../lib/metrcClient.js";
import { buildMetrcClientAuthPlan } from "../lib/metrcAuthStrategy.js";
import { loadCompanyMetrcConfig } from "../lib/metrcConfigLoader.js";
import { resolveMetrcApiBaseUrl } from "../lib/metrcResolveBaseUrl.js";
import {
  resolveMetrcSandboxUiStatus,
  sandboxStatusLabel,
  type MetrcSandboxUiStatus,
} from "../lib/metrcSandboxStatus.js";
import type { MetrcClientAuthMode } from "../lib/metrcAuthStrategy.js";

export type MetrcDebugAuthAttempt = {
  authMode: MetrcClientAuthMode;
  status: number;
  metrcMessage: string;
  maskedHeaders: Record<string, string>;
  usedBasicAuth: boolean;
};

export type MetrcDebugAuthResponse = {
  ok: true;
  environment: string;
  sandboxMode: boolean;
  baseUrl: string | null;
  endpointTested: string;
  licenseNumber: string;
  hasVendorKey: boolean;
  hasUserKey: boolean;
  sandboxUiStatus: MetrcSandboxUiStatus;
  sandboxUiStatusLabel: string;
  provisioningComplete: boolean;
  userCreationPending: boolean;
  operationalAccessGranted: boolean;
  attempts: MetrcDebugAuthAttempt[];
  lastStatus: number;
  lastMetrcMessage: string;
  successfulAuthMode: MetrcClientAuthMode | null;
};

export class MetrcDebugAuthService {
  async runDebugAuth(input: {
    companyId: string;
  }): Promise<MetrcDebugAuthResponse | { ok: false; message: string }> {
    if (env.NODE_ENV === "production") {
      return { ok: false, message: "METRC debug auth is disabled in production." };
    }

    const loaded = await loadCompanyMetrcConfig(input.companyId);
    if (!loaded) {
      return { ok: false, message: "Company configuration not found." };
    }

    const baseUrl =
      resolveMetrcApiBaseUrl({
        stateCode: loaded.stateCode,
        environment: loaded.environment,
        apiBaseUrlOverride: loaded.apiBaseUrlOverride,
      }) ?? null;

    const licenseNumber = loaded.licenseNumber || "SBX-CO";
    const endpointTested = `/locations/v2/active?licenseNumber=${encodeURIComponent(licenseNumber)}`;
    const sandboxMode = loaded.environment === "sandbox";
    const hasUserKey = Boolean(loaded.userApiKey.trim());
    const provisioningComplete = Boolean(loaded.metrc.sandboxReady) && hasUserKey;
    const userCreationPending = Boolean(loaded.metrc.sandboxProvisioning) && !hasUserKey;

    const client = MetrcClient.fromLoadedConfig(loaded, input.companyId);
    const plan = buildMetrcClientAuthPlan({
      companyId: input.companyId,
      vendorOnly: false,
      environment: loaded.environment,
    });

    const attempts: MetrcDebugAuthAttempt[] = [];
    let successfulAuthMode: MetrcClientAuthMode | null = null;
    let lastStatus = 0;
    let lastMetrcMessage = "";
    let operationalAccessGranted = false;

    for (const mode of plan) {
      const probe = await client.probeAuthMode(endpointTested, mode);
      attempts.push({
        authMode: probe.authMode,
        status: probe.status,
        metrcMessage: probe.metrcMessage,
        maskedHeaders: probe.maskedHeaders,
        usedBasicAuth: probe.usedBasicAuth,
      });
      lastStatus = probe.status;
      lastMetrcMessage = probe.metrcMessage;

      if (probe.status >= 200 && probe.status < 300) {
        successfulAuthMode = mode;
        operationalAccessGranted = true;
        break;
      }
      if (!shouldTryNextMetrcAuthMode(probe.status)) break;
    }

    const sandboxUiStatus = resolveMetrcSandboxUiStatus({
      sandboxProvisioning: Boolean(loaded.metrc.sandboxProvisioning),
      sandboxReady: Boolean(loaded.metrc.sandboxReady),
      credentialsReady: Boolean(loaded.vendorApiKey && loaded.userApiKey && licenseNumber),
      hasUserApiKey: hasUserKey,
      lastConnectionStatus: String(loaded.metrc.metrcLastConnectionStatus || ""),
      lastConnectionHttpStatus:
        typeof loaded.metrc.metrcLastConnectionHttpStatus === "number"
          ? loaded.metrc.metrcLastConnectionHttpStatus
          : null,
    });

    logInfo("[METRC] debug_auth_complete", {
      companyId: input.companyId,
      sandboxMode,
      endpointTested,
      attemptCount: attempts.length,
      lastStatus,
      successfulAuthMode,
      operationalAccessGranted,
    });

    return {
      ok: true,
      environment: loaded.environment,
      sandboxMode,
      baseUrl,
      endpointTested,
      licenseNumber,
      hasVendorKey: Boolean(loaded.vendorApiKey),
      hasUserKey,
      sandboxUiStatus,
      sandboxUiStatusLabel: sandboxStatusLabel(sandboxUiStatus),
      provisioningComplete,
      userCreationPending,
      operationalAccessGranted,
      attempts,
      lastStatus,
      lastMetrcMessage,
      successfulAuthMode,
    };
  }
}
