import { ConfigService } from "./configService.js";
import { logInfo, logWarn } from "../lib/logger.js";
import {
  MetrcClient,
  isMetrcClientFailure,
  type MetrcClientAuthMode,
  type MetrcClientFailure,
} from "../lib/metrcClient.js";
import { loadCompanyMetrcConfig } from "../lib/metrcConfigLoader.js";
import { resolveMetrcApiBaseUrl } from "../lib/metrcResolveBaseUrl.js";
import type { MetrcAttemptFailure } from "../lib/metrcConnectionAttempts.js";
import { parseLocationsPayload, toSampleLocation } from "../lib/metrcConnectionHelpers.js";
import {
  orderMetrcEndpointCandidates,
  shouldTryNextMetrcEndpoint,
} from "../lib/metrcEndpoints.js";
import {
  buildMetrcCredentialHintFromLoaded,
  logMetrcCredentialDiagnostics,
} from "../lib/metrcCredentialDiagnostics.js";

export type MetrcTestConnectionSuccess = {
  ok: true;
  connected: true;
  checkedAt: string;
  baseUrl: string;
  licenseNumber: string;
  locationCount: number;
  sampleLocations: ReturnType<typeof toSampleLocation>[];
  authMode: MetrcClientAuthMode;
  userKeyLength: number;
  vendorKeyLength: number;
};

export type MetrcTestConnectionFailure = {
  ok: false;
  connected: false;
  checkedAt: string;
  status: number;
  message: string;
  credentialHint: string;
  baseUrl: string | null;
  licenseNumber: string;
  userKeyLength: number;
  vendorKeyLength: number;
  attemptedModes: MetrcClientAuthMode[];
  failures: MetrcAttemptFailure[];
};

export type MetrcTestConnectionResponse = MetrcTestConnectionSuccess | MetrcTestConnectionFailure;

function failuresFromClientAttempt(
  modes: MetrcClientAuthMode[],
  status: number,
  durationMs: number,
  message: string,
): MetrcAttemptFailure[] {
  if (!modes.length) return [];
  return modes.map((mode, i) => ({
    mode: mode as MetrcAttemptFailure["mode"],
    status: i === modes.length - 1 ? status : 401,
    durationMs: i === modes.length - 1 ? durationMs : 0,
    metrcSnippet: i === modes.length - 1 ? message.slice(0, 200) : null,
  }));
}

export class MetrcConnectionService {
  configService = new ConfigService();

  async runTestConnection(input: {
    companyId: string;
    actorUserId: string;
  }): Promise<MetrcTestConnectionResponse> {
    const checkedAt = new Date().toISOString();
    const loaded = await loadCompanyMetrcConfig(input.companyId);

    if (!loaded) {
      const fail: MetrcTestConnectionFailure = {
        ok: false,
        connected: false,
        checkedAt,
        status: 404,
        message: "Company configuration not found.",
        credentialHint: "Save company configuration before testing METRC.",
        baseUrl: null,
        licenseNumber: "",
        userKeyLength: 0,
        vendorKeyLength: 0,
        attemptedModes: [],
        failures: [],
      };
      return fail;
    }

    const baseUrl =
      resolveMetrcApiBaseUrl({
        stateCode: loaded.stateCode,
        environment: loaded.environment,
        apiBaseUrlOverride: loaded.apiBaseUrlOverride,
      }) ?? null;
    const licenseNumber = loaded.licenseNumber;
    const userKeyLength = loaded.userApiKey.length;
    const vendorKeyLength = loaded.vendorApiKey.length;
    const credentialHint = buildMetrcCredentialHintFromLoaded(loaded);

    if (!baseUrl || !licenseNumber) {
      const fail: MetrcTestConnectionFailure = {
        ok: false,
        connected: false,
        checkedAt,
        status: 400,
        message: "Bad request. Check license number, state, and base URL. Save settings before testing.",
        credentialHint,
        baseUrl,
        licenseNumber: licenseNumber || "",
        userKeyLength,
        vendorKeyLength,
        attemptedModes: [],
        failures: [],
      };
      await this.persistConnectionSnapshot(
        input.companyId,
        input.actorUserId,
        loaded.company,
        loaded.metrc,
        fail,
      );
      return fail;
    }

    if (!userKeyLength) {
      const fail: MetrcTestConnectionFailure = {
        ok: false,
        connected: false,
        checkedAt,
        status: 400,
        message: "User API key is required. Save a facility user key before testing.",
        credentialHint,
        baseUrl,
        licenseNumber,
        userKeyLength,
        vendorKeyLength,
        attemptedModes: [],
        failures: [],
      };
      await this.persistConnectionSnapshot(
        input.companyId,
        input.actorUserId,
        loaded.company,
        loaded.metrc,
        fail,
      );
      return fail;
    }

    const client = MetrcClient.fromLoadedConfig(loaded, input.companyId);
    const candidates = orderMetrcEndpointCandidates(
      { stateCode: loaded.stateCode || "CO", environment: loaded.environment },
      "rooms",
      licenseNumber,
    );

    let lastFailure: MetrcClientFailure | null = null;

    for (let i = 0; i < candidates.length; i += 1) {
      const path = candidates[i]!;
      const result = await client.get<unknown>(path);

      if (!isMetrcClientFailure(result)) {
        logInfo("[METRC] endpoint_success", {
          companyId: input.companyId,
          resource: "rooms",
          endpoint: path.split("?")[0],
          pathnameAndQuery: path,
          status: result.status,
          purpose: "test_connection",
          auth_mode: result.authMode,
        });

        const locations = parseLocationsPayload(result.data);
        const success: MetrcTestConnectionSuccess = {
          ok: true,
          connected: true,
          checkedAt,
          baseUrl: client.baseUrl ?? baseUrl,
          licenseNumber,
          locationCount: locations.length,
          sampleLocations: locations.slice(0, 5).map(toSampleLocation),
          authMode: result.authMode as MetrcClientAuthMode,
          userKeyLength,
          vendorKeyLength,
        };
        await this.persistConnectionSnapshot(
          input.companyId,
          input.actorUserId,
          loaded.company,
          loaded.metrc,
          success,
        );
        return success;
      }

      lastFailure = result;

      if (
        shouldTryNextMetrcEndpoint("rooms", i, candidates.length, {
          status: result.status,
          upstreamType: result.upstreamError?.type,
        })
      ) {
        logInfo("[METRC] connection_test_endpoint_fallback", {
          companyId: input.companyId,
          from: path.split("?")[0],
          next: candidates[i + 1]?.split("?")[0] ?? null,
        });
        continue;
      }
      break;
    }

    if (!lastFailure) {
      const fail: MetrcTestConnectionFailure = {
        ok: false,
        connected: false,
        checkedAt,
        status: 502,
        message: "METRC connection test failed.",
        credentialHint,
        baseUrl,
        licenseNumber,
        userKeyLength,
        vendorKeyLength,
        attemptedModes: [],
        failures: [],
      };
      await this.persistConnectionSnapshot(
        input.companyId,
        input.actorUserId,
        loaded.company,
        loaded.metrc,
        fail,
      );
      return fail;
    }

    logMetrcCredentialDiagnostics({
      companyId: input.companyId,
      purpose: "test_connection",
      userKeyLength,
      vendorKeyLength,
      licensePresent: Boolean(licenseNumber),
      attemptedAuthModes: lastFailure.attemptedAuthModes,
    });

    const fail: MetrcTestConnectionFailure = {
      ok: false,
      connected: false,
      checkedAt,
      status: lastFailure.status || 401,
      message: `${lastFailure.message} ${credentialHint}`.trim().slice(0, 4000),
      credentialHint,
      baseUrl: client.baseUrl ?? baseUrl,
      licenseNumber,
      userKeyLength,
      vendorKeyLength,
      attemptedModes: lastFailure.attemptedAuthModes,
      failures: failuresFromClientAttempt(
        lastFailure.attemptedAuthModes,
        lastFailure.status,
        lastFailure.durationMs,
        lastFailure.message,
      ),
    };

    logWarn("[METRC] connection_test_failed_all_modes", {
      companyId: input.companyId,
      attemptCount: lastFailure.attemptedAuthModes.length,
      lastStatus: lastFailure.status,
      userKeyLength,
      vendorKeyLength,
    });

    await this.persistConnectionSnapshot(
      input.companyId,
      input.actorUserId,
      loaded.company,
      loaded.metrc,
      fail,
    );
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

    await this.configService.upsert({
      companyId,
      actorUserId,
      key: "company",
      value: { ...company, metrc: nextMetrc },
    });
  }
}
