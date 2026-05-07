import { ConfigService } from "../services/configService.js";
import { logInfo, logWarn } from "./logger.js";
import { resolveMetrcApiBaseUrl } from "./metrcResolveBaseUrl.js";
import {
  buildAuthorizationHeader,
  buildMetrcAttemptPlan,
  type MetrcAttemptFailure,
  type MetrcAuthModeUsed,
} from "./metrcConnectionAttempts.js";
import { extractMetrcApiErrorSummary } from "./metrcConnectionHelpers.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

async function fetchMetrcOnce(
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

export type MetrcPerformGetSuccess = {
  ok: true;
  baseUrl: string;
  licenseNumber: string;
  authMode: MetrcAuthModeUsed;
  bodyJson: unknown;
};

export type MetrcPerformGetFailure = {
  ok: false;
  status: number;
  message: string;
  baseUrl: string | null;
  licenseNumber: string;
  attemptedModes: MetrcAuthModeUsed[];
  failures: MetrcAttemptFailure[];
};

export type MetrcPerformGetResult = MetrcPerformGetSuccess | MetrcPerformGetFailure;

function summarizeAllAttemptsFailed(failures: MetrcAttemptFailure[]): string {
  if (!failures.length) return "METRC request failed.";
  const last = failures[failures.length - 1];
  const modes = failures.map((f) => f.mode).join(", ");
  const snippet = last.metrcSnippet ? ` ${last.metrcSnippet}` : "";
  return `Every auth mode failed (${modes}). Last: HTTP ${last.status}.${snippet}`.slice(0, 4000);
}

/**
 * Read-only GET against METRC using company `config.company.metrc` credentials.
 * `pathnameAndQuery` must start with `/` (e.g. `/tags/v2/plant/available?licenseNumber=…`).
 */
export async function performMetrcAuthorizedGet(input: {
  companyId: string;
  pathnameAndQuery: string;
}): Promise<MetrcPerformGetResult> {
  const configService = new ConfigService();
  const rows = await configService.list(input.companyId);
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
    return {
      ok: false,
      status: 400,
      message: "Bad request. Check license number, state, and base URL in Admin → METRC settings.",
      baseUrl: baseUrl || null,
      licenseNumber: licenseNumber || "",
      attemptedModes: [],
      failures: [],
    };
  }

  if (!userKey) {
    return {
      ok: false,
      status: 400,
      message: "User API key is required. Save a facility user key in Admin → METRC settings.",
      baseUrl,
      licenseNumber,
      attemptedModes: [],
      failures: [],
    };
  }

  const path = String(input.pathnameAndQuery || "").trim();
  if (!path.startsWith("/")) {
    return {
      ok: false,
      status: 400,
      message: "Invalid METRC path.",
      baseUrl,
      licenseNumber,
      attemptedModes: [],
      failures: [],
    };
  }

  const url = `${baseUrl.replace(/\/+$/, "")}${path}`;
  const hasVendorKey = Boolean(apiKey);

  try {
    const plan = buildMetrcAttemptPlan(hasVendorKey);
    const failures: MetrcAttemptFailure[] = [];
    const attemptedModes: MetrcAuthModeUsed[] = [];

    for (const mode of plan) {
      const authorization = buildAuthorizationHeader(mode, apiKey, userKey);
      if (!authorization) continue;

      attemptedModes.push(mode);
      const t0 = Date.now();
      const { res, bodyText, bodyJson } = await fetchMetrcOnce(url, authorization);
      const durationMs = Math.max(0, Date.now() - t0);
      const metrcSnippet = extractMetrcApiErrorSummary(bodyJson, bodyText);

      logInfo("[METRC] authorized_get_attempt", {
        companyId: input.companyId,
        path: path.split("?")[0],
        mode,
        status: res.status,
        durationMs,
        metrcSnippetPresent: Boolean(metrcSnippet),
      });

      if (res.ok) {
        logInfo("[METRC] authorized_get_ok", {
          companyId: input.companyId,
          path: path.split("?")[0],
          authMode: mode,
          attemptsBeforeSuccess: failures.length + 1,
        });
        return {
          ok: true,
          baseUrl,
          licenseNumber,
          authMode: mode,
          bodyJson,
        };
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
    logWarn("[METRC] authorized_get_failed_all_modes", {
      companyId: input.companyId,
      path: path.split("?")[0],
      attemptCount: failures.length,
      lastStatus: status,
    });
    return {
      ok: false,
      status,
      message: summarizeAllAttemptsFailed(failures),
      baseUrl,
      licenseNumber,
      attemptedModes,
      failures,
    };
  } catch (error) {
    logWarn("[METRC] authorized_get_transport_error", {
      companyId: input.companyId,
      path: path.split("?")[0],
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      status: 0,
      message: "Unable to reach METRC from the API server.",
      baseUrl,
      licenseNumber,
      attemptedModes: [],
      failures: [],
    };
  }
}
