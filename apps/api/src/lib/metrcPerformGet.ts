import { logInfo, logWarn } from "./logger.js";
import { MetrcClient, isMetrcClientFailure } from "./metrcClient.js";
import { loadCompanyMetrcConfig } from "./metrcConfigLoader.js";
import type { MetrcAttemptFailure, MetrcAuthModeUsed } from "./metrcConnectionAttempts.js";

export type MetrcPerformGetSuccess = {
  ok: true;
  baseUrl: string;
  licenseNumber: string;
  authMode: string;
  bodyJson: unknown;
};

export type MetrcPerformGetFailure = {
  ok: false;
  status: number;
  message: string;
  baseUrl: string | null;
  licenseNumber: string;
  attemptedModes: string[];
  failures: MetrcAttemptFailure[];
};

export type MetrcPerformGetResult = MetrcPerformGetSuccess | MetrcPerformGetFailure;

/** Works with `strict: false` where `!r.ok` does not narrow discriminated unions reliably. */
export function isMetrcPerformGetFailure(r: MetrcPerformGetResult): r is MetrcPerformGetFailure {
  return r.ok === false;
}

/**
 * Read-only GET against METRC using company `config.company.metrc` credentials.
 * Uses the same Colorado sandbox auth as `MetrcClient` (Basic vendor:user).
 */
export async function performMetrcAuthorizedGet(input: {
  companyId: string;
  pathnameAndQuery: string;
}): Promise<MetrcPerformGetResult> {
  const loaded = await loadCompanyMetrcConfig(input.companyId);
  if (!loaded) {
    return {
      ok: false as const,
      status: 404,
      message: "Company configuration not found.",
      baseUrl: null,
      licenseNumber: "",
      attemptedModes: [],
      failures: [],
    };
  }

  const path = String(input.pathnameAndQuery || "").trim();
  if (!path.startsWith("/")) {
    return {
      ok: false as const,
      status: 400,
      message: "Invalid METRC path.",
      baseUrl: null,
      licenseNumber: loaded.licenseNumber,
      attemptedModes: [],
      failures: [],
    };
  }

  const client = MetrcClient.fromLoadedConfig(loaded, input.companyId);
  const baseUrl = client.baseUrl;

  if (!baseUrl || !loaded.licenseNumber) {
    return {
      ok: false as const,
      status: 400,
      message: "Bad request. Check license number, state, and base URL in Admin → METRC settings.",
      baseUrl: baseUrl || null,
      licenseNumber: loaded.licenseNumber || "",
      attemptedModes: [],
      failures: [],
    };
  }

  if (!loaded.userApiKey || !loaded.vendorApiKey) {
    return {
      ok: false as const,
      status: 400,
      message: "Vendor and user API keys are required. Save METRC keys in Admin → Company Config.",
      baseUrl,
      licenseNumber: loaded.licenseNumber,
      attemptedModes: [],
      failures: [],
    };
  }

  try {
    const result = await client.get<unknown>(path);

    if (!isMetrcClientFailure(result)) {
      logInfo("[METRC] authorized_get_ok", {
        companyId: input.companyId,
        path: path.split("?")[0],
        authMode: result.authMode,
      });
      return {
        ok: true as const,
        baseUrl,
        licenseNumber: loaded.licenseNumber,
        authMode: result.authMode,
        bodyJson: result.data,
      };
    }

    logWarn("[METRC] authorized_get_failed", {
      companyId: input.companyId,
      path: path.split("?")[0],
      status: result.status,
      authMode: result.attemptedAuthModes[0] ?? "basic_vendor_user",
    });

    const mode = result.attemptedAuthModes[0] ?? "basic_vendor_user";
    return {
      ok: false as const,
      status: result.status,
      message: result.message,
      baseUrl,
      licenseNumber: loaded.licenseNumber,
      attemptedModes: [mode],
      failures: [
        {
          mode: "basic_vendor_user" as MetrcAttemptFailure["mode"],
          status: result.status,
          durationMs: result.durationMs,
          metrcSnippet: result.message.slice(0, 200) || null,
        },
      ],
    };
  } catch (error) {
    logWarn("[METRC] authorized_get_transport_error", {
      companyId: input.companyId,
      path: path.split("?")[0],
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false as const,
      status: 0,
      message: "Unable to reach METRC from the API server.",
      baseUrl,
      licenseNumber: loaded.licenseNumber,
      attemptedModes: [],
      failures: [],
    };
  }
}
