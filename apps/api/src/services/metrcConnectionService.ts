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
import { resolveMetrcLocationsActiveRequest } from "../lib/metrcLocationsActiveQuery.js";
import {
  buildMetrcCredentialHintFromLoaded,
  buildMetrcOperationalAccessDeniedHint,
  logMetrcCredentialDiagnostics,
} from "../lib/metrcCredentialDiagnostics.js";
import { remediateSwappedMetrcSlots } from "../lib/metrcCredentialSlots.js";
import { formatMetrcKeyFingerprint } from "../lib/metrcKeyFingerprint.js";
import {
  METRC_KEYS_SWAPPED_HINT,
  probeMetrcKeysPossiblySwapped,
} from "../lib/metrcKeySwapProbe.js";
import {
  applyMetrcFailureStatus,
  applyMetrcSuccessStatus,
  formatMetrcFailureMessage,
  formatMetrcSuccessMessage,
} from "../lib/metrcStatusPersistence.js";
import {
  applyMetrcOperationalSuccess,
  isMetrcProvisioningComplete,
  pickMetrcFacilityNameFromLocations,
} from "../lib/metrcOperationalStatus.js";
import {
  resolveMetrcSandboxUiStatus,
  sandboxStatusLabel,
  type MetrcSandboxUiStatus,
} from "../lib/metrcSandboxStatus.js";

export type MetrcConnectionDiagnostics = {
  sandboxStatus: MetrcSandboxUiStatus;
  sandboxStatusLabel: string;
  lastAttemptedAuthMode: MetrcClientAuthMode | null;
  metrcResponseCode: number;
  metrcResponseMessage: string;
  provisioningComplete: boolean;
  userCreationPending: boolean;
  operationalAccessGranted: boolean;
  environment: string;
};

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
  diagnostics: MetrcConnectionDiagnostics;
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
  diagnostics: MetrcConnectionDiagnostics;
  keysPossiblySwapped?: boolean;
};

export type MetrcTestConnectionResponse = MetrcTestConnectionSuccess | MetrcTestConnectionFailure;

function buildConnectionDiagnostics(input: {
  loaded: NonNullable<Awaited<ReturnType<typeof loadCompanyMetrcConfig>>>;
  status: number;
  metrcMessage: string;
  attemptedModes: MetrcClientAuthMode[];
  operationalAccessGranted: boolean;
}): MetrcConnectionDiagnostics {
  const hasUserKey = Boolean(input.loaded.userApiKey.trim());
  const operationalAccessGranted =
    input.operationalAccessGranted || Boolean(input.loaded.metrc.metrcOperationalAccessGranted);
  const provisioningComplete =
    operationalAccessGranted ||
    isMetrcProvisioningComplete(input.loaded.metrc, hasUserKey);
  const userCreationPending = Boolean(input.loaded.metrc.sandboxProvisioning) && !hasUserKey;
  const sandboxStatus: MetrcSandboxUiStatus = operationalAccessGranted
    ? "connected"
    : resolveMetrcSandboxUiStatus({
        sandboxProvisioning: Boolean(input.loaded.metrc.sandboxProvisioning),
        sandboxReady: Boolean(input.loaded.metrc.sandboxReady),
        credentialsReady: Boolean(
          input.loaded.vendorApiKey && input.loaded.userApiKey && input.loaded.licenseNumber,
        ),
        hasUserApiKey: hasUserKey,
        lastConnectionStatus: String(input.loaded.metrc.metrcLastConnectionStatus || ""),
        lastConnectionHttpStatus: input.status,
      });

  return {
    sandboxStatus,
    sandboxStatusLabel: sandboxStatusLabel(sandboxStatus),
    lastAttemptedAuthMode: input.attemptedModes[input.attemptedModes.length - 1] ?? null,
    metrcResponseCode: input.status,
    metrcResponseMessage:
      input.status === 200
        ? formatMetrcSuccessMessage({ kind: "connection_test" })
        : formatMetrcFailureMessage(input.status, input.metrcMessage).slice(0, 2000),
    provisioningComplete,
    userCreationPending,
    operationalAccessGranted,
    environment: input.loaded.environment,
  };
}

function failuresFromClientAttempt(input: {
  authAttempts: { mode: MetrcClientAuthMode; status: number; durationMs: number; metrcMessage: string }[];
  modes: MetrcClientAuthMode[];
  status: number;
  durationMs: number;
  message: string;
}): MetrcAttemptFailure[] {
  if (input.authAttempts.length) {
    return input.authAttempts.map((a) => ({
      mode: a.mode as MetrcAttemptFailure["mode"],
      status: a.status,
      durationMs: a.durationMs,
      metrcSnippet: a.metrcMessage.slice(0, 200) || null,
    }));
  }
  if (!input.modes.length) return [];
  return input.modes.map((mode, i) => ({
    mode: mode as MetrcAttemptFailure["mode"],
    status: i === input.modes.length - 1 ? input.status : 401,
    durationMs: i === input.modes.length - 1 ? input.durationMs : 0,
    metrcSnippet: i === input.modes.length - 1 ? input.message.slice(0, 200) : null,
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
        diagnostics: {
          sandboxStatus: "idle",
          sandboxStatusLabel: sandboxStatusLabel("idle"),
          lastAttemptedAuthMode: null,
          metrcResponseCode: 404,
          metrcResponseMessage: "Company configuration not found.",
          provisioningComplete: false,
          userCreationPending: false,
          operationalAccessGranted: false,
          environment: "sandbox",
        },
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
        diagnostics: buildConnectionDiagnostics({
          loaded,
          status: 400,
          metrcMessage: "Bad request. Check license number, state, and base URL.",
          attemptedModes: [],
          operationalAccessGranted: false,
        }),
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

    const isSandbox = loaded.environment === "sandbox";

    if (!userKeyLength && !isSandbox) {
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
        diagnostics: buildConnectionDiagnostics({
          loaded,
          status: 400,
          metrcMessage: "User API key is required.",
          attemptedModes: [],
          operationalAccessGranted: false,
        }),
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

    logInfo("[METRC] config_keys_loaded", {
      companyId: input.companyId,
      vendorKeyLoaded: formatMetrcKeyFingerprint(loaded.vendorApiKey),
      userKeyLoaded: formatMetrcKeyFingerprint(loaded.userApiKey),
      vendorSlot: "apiKey",
      userSlot: "userKey",
    });

    const client = MetrcClient.fromLoadedConfig(loaded, input.companyId);
    const locationsRequest = await resolveMetrcLocationsActiveRequest({
      client,
      loaded,
      companyId: input.companyId,
      purpose: "test_connection",
    });
    const operationalLicense = locationsRequest.params.licenseNumber;
    const candidates = orderMetrcEndpointCandidates(
      { stateCode: loaded.stateCode || "CO", environment: loaded.environment },
      "rooms",
      locationsRequest.params,
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
        const facilityName = pickMetrcFacilityNameFromLocations(locations);
        const success: MetrcTestConnectionSuccess = {
          ok: true,
          connected: true,
          checkedAt,
          baseUrl: client.baseUrl ?? baseUrl,
          licenseNumber: operationalLicense,
          locationCount: locations.length,
          sampleLocations: locations.slice(0, 5).map(toSampleLocation),
          authMode: result.authMode as MetrcClientAuthMode,
          userKeyLength,
          vendorKeyLength,
          diagnostics: buildConnectionDiagnostics({
            loaded,
            status: result.status,
            metrcMessage: result.metrcMessage,
            attemptedModes: [result.authMode],
            operationalAccessGranted: true,
          }),
        };
        await this.persistConnectionSnapshot(
          input.companyId,
          input.actorUserId,
          loaded.company,
          loaded.metrc,
          success,
          { operationalLicense, facilityName },
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
        diagnostics: buildConnectionDiagnostics({
          loaded,
          status: 502,
          metrcMessage: "METRC connection test failed.",
          attemptedModes: [],
          operationalAccessGranted: false,
        }),
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

    const metrcMsg = lastFailure.metrcMessage || lastFailure.message;
    const testPath = candidates[0] ?? locationsRequest.pathnameAndQuery;
    let keysPossiblySwapped = false;
    let finalHint = credentialHint;
    if ((lastFailure.status || 401) === 401 && loaded.userApiKey && loaded.vendorApiKey) {
      try {
        keysPossiblySwapped = await probeMetrcKeysPossiblySwapped({
          loaded,
          companyId: input.companyId,
          pathnameAndQuery: testPath,
        });
        if (keysPossiblySwapped) {
          finalHint = METRC_KEYS_SWAPPED_HINT;
          logWarn("[METRC] keys_possibly_swapped", {
            companyId: input.companyId,
            licenseNumber,
          });

          const remediatedMetrc = remediateSwappedMetrcSlots(loaded.metrc);
          await this.configService.upsert({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            key: "company",
            value: { ...loaded.company, metrc: remediatedMetrc },
          });

          const reloaded = await loadCompanyMetrcConfig(input.companyId);
          if (reloaded) {
            logInfo("[METRC] config_keys_remediated", {
              companyId: input.companyId,
              vendorKeyLoaded: formatMetrcKeyFingerprint(reloaded.vendorApiKey),
              userKeyLoaded: formatMetrcKeyFingerprint(reloaded.userApiKey),
            });

            const retryClient = MetrcClient.fromLoadedConfig(reloaded, input.companyId);
            const retryResult = await retryClient.get<unknown>(testPath);
            if (!isMetrcClientFailure(retryResult)) {
              const locations = parseLocationsPayload(retryResult.data);
              const facilityName = pickMetrcFacilityNameFromLocations(locations);
              const success: MetrcTestConnectionSuccess = {
                ok: true,
                connected: true,
                checkedAt,
                baseUrl: retryClient.baseUrl ?? baseUrl,
                licenseNumber: operationalLicense,
                locationCount: locations.length,
                sampleLocations: locations.slice(0, 5).map(toSampleLocation),
                authMode: retryResult.authMode as MetrcClientAuthMode,
                userKeyLength: reloaded.userApiKey.length,
                vendorKeyLength: reloaded.vendorApiKey.length,
                diagnostics: buildConnectionDiagnostics({
                  loaded: reloaded,
                  status: retryResult.status,
                  metrcMessage: retryResult.metrcMessage,
                  attemptedModes: [retryResult.authMode],
                  operationalAccessGranted: true,
                }),
              };
              await this.persistConnectionSnapshot(
                input.companyId,
                input.actorUserId,
                reloaded.company,
                reloaded.metrc,
                success,
                { operationalLicense, facilityName },
              );
              return success;
            }
          }
        }
      } catch (err) {
        logWarn("[METRC] swap_probe_failed", {
          companyId: input.companyId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      if (!keysPossiblySwapped && loaded.userApiKey && loaded.vendorApiKey) {
        finalHint = buildMetrcOperationalAccessDeniedHint(licenseNumber);
      }
    }

    const fail: MetrcTestConnectionFailure = {
      ok: false,
      connected: false,
      checkedAt,
      status: lastFailure.status || 401,
      message: `${metrcMsg} ${finalHint}`.trim().slice(0, 4000),
      credentialHint: finalHint,
      keysPossiblySwapped: keysPossiblySwapped || undefined,
      baseUrl: client.baseUrl ?? baseUrl,
      licenseNumber: operationalLicense,
      userKeyLength,
      vendorKeyLength,
      attemptedModes: lastFailure.attemptedAuthModes,
      failures: failuresFromClientAttempt({
        authAttempts: lastFailure.authAttempts ?? [],
        modes: lastFailure.attemptedAuthModes,
        status: lastFailure.status,
        durationMs: lastFailure.durationMs,
        message: metrcMsg,
      }),
      diagnostics: buildConnectionDiagnostics({
        loaded,
        status: lastFailure.status || 401,
        metrcMessage: metrcMsg,
        attemptedModes: lastFailure.attemptedAuthModes,
        operationalAccessGranted: false,
      }),
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
    operationalPatch?: { operationalLicense?: string; facilityName?: string | null },
  ): Promise<void> {
    let nextMetrc: Record<string, unknown> = { ...metrc };
    nextMetrc.metrcLastConnectionCheckedAt = result.checkedAt;

    if (result.ok && result.connected) {
      const success = result as MetrcTestConnectionSuccess;
      nextMetrc = applyMetrcOperationalSuccess(nextMetrc, {
        operationalLicense: operationalPatch?.operationalLicense ?? success.licenseNumber,
        facilityName: operationalPatch?.facilityName ?? null,
      });
      nextMetrc = applyMetrcSuccessStatus(nextMetrc, {
        httpStatus: success.diagnostics.metrcResponseCode ?? 200,
        message: formatMetrcSuccessMessage({ kind: "connection_test" }),
        checkedAt: result.checkedAt,
      });
      nextMetrc.metrcLastLocationCount = success.locationCount;
      nextMetrc.metrcLastSuccessfulAuthMode = success.authMode;
      nextMetrc.metrcSandboxOperationalStatus = "connected";
    } else {
      const fail = result as MetrcTestConnectionFailure;
      const httpStatus =
        typeof fail.status === "number" && Number.isFinite(fail.status) ? fail.status : 502;
      nextMetrc = applyMetrcFailureStatus(nextMetrc, {
        httpStatus,
        message: formatMetrcFailureMessage(httpStatus, fail.diagnostics.metrcResponseMessage),
        checkedAt: result.checkedAt,
      });
      nextMetrc.metrcLastLocationCount = null;
      nextMetrc.metrcLastSuccessfulAuthMode = fail.diagnostics.lastAttemptedAuthMode;
      nextMetrc.metrcSandboxOperationalStatus = fail.diagnostics.sandboxStatus;
      nextMetrc.metrcOperationalAccessGranted = fail.diagnostics.operationalAccessGranted;
      nextMetrc.metrcLastAuthAttemptMode = fail.diagnostics.lastAttemptedAuthMode;
    }

    await this.configService.upsert({
      companyId,
      actorUserId,
      key: "company",
      value: { ...company, metrc: nextMetrc },
    });
  }
}
