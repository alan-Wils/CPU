import { logInfo, logWarn } from "../lib/logger.js";
import { MetrcClient, isMetrcClientFailure } from "../lib/metrcClient.js";
import { loadCompanyMetrcConfig } from "../lib/metrcConfigLoader.js";
import {
  pickFirstActivePackageAdjustmentReason,
  parseMetrcPackageAdjustmentReasonsPayload,
  type ParsedMetrcPackageAdjustmentReason,
} from "../lib/metrcPackageAdjustmentReasonsParse.js";
import { resolveMetrcLocationsActiveRequest } from "../lib/metrcLocationsActiveQuery.js";
import { isMetrcSandboxPlaceholderLicense } from "../lib/metrcOperationalStatus.js";

function licenseQuery(licenseNumber: string): string {
  const license = String(licenseNumber || "").trim();
  return license ? `?licenseNumber=${encodeURIComponent(license)}` : "";
}

export function buildPackageAdjustmentReasonsPathCandidates(licenseNumber: string): string[] {
  const q = licenseQuery(licenseNumber);
  return [`/packages/v2/adjust/reasons${q}`, `/packages/v1/adjust/reasons${q}`];
}

export type MetrcPackageAdjustmentReasonsAttempt = {
  endpoint: string;
  httpStatus: number;
  response: unknown;
};

export type MetrcPackageAdjustmentReasonsSuccess = {
  ok: true;
  licenseNumber: string;
  endpoint: string;
  attemptedEndpoints: string[];
  reasons: ParsedMetrcPackageAdjustmentReason[];
  selectedReason: ParsedMetrcPackageAdjustmentReason;
  rawResponse: unknown;
};

export type MetrcPackageAdjustmentReasonsFailure = {
  ok: false;
  message: string;
  licenseNumber: string;
  attemptedEndpoints: string[];
  attempts: MetrcPackageAdjustmentReasonsAttempt[];
};

export type MetrcPackageAdjustmentReasonsResult =
  | MetrcPackageAdjustmentReasonsSuccess
  | MetrcPackageAdjustmentReasonsFailure;

export async function fetchMetrcPackageAdjustmentReasons(input: {
  client: MetrcClient;
  companyId: string;
  licenseNumber: string;
  loaded: NonNullable<Awaited<ReturnType<typeof loadCompanyMetrcConfig>>>;
}): Promise<MetrcPackageAdjustmentReasonsResult> {
  let license = String(input.licenseNumber || "").trim();
  if (!license) {
    return {
      ok: false,
      message: "Facility license number is required to fetch package adjustment reasons.",
      licenseNumber: "",
      attemptedEndpoints: [],
      attempts: [],
    };
  }

  if (isMetrcSandboxPlaceholderLicense(license)) {
    const locationsRequest = await resolveMetrcLocationsActiveRequest({
      client: input.client,
      loaded: input.loaded,
      companyId: input.companyId,
      purpose: "package_adjustment_reasons",
    });
    license = locationsRequest.params.licenseNumber;
  }

  const candidates = buildPackageAdjustmentReasonsPathCandidates(license);
  const attempts: MetrcPackageAdjustmentReasonsAttempt[] = [];

  for (const pathname of candidates) {
    const endpointKey = pathname.split("?")[0] || pathname;
    const result = await input.client.get<unknown>(pathname);

    if (isMetrcClientFailure(result)) {
      attempts.push({
        endpoint: endpointKey,
        httpStatus: result.status || 502,
        response: {
          message: result.message,
          metrcMessage: result.metrcMessage,
          status: result.status,
        },
      });
      logWarn("[METRC] package_adjustment_reasons_endpoint_failed", {
        companyId: input.companyId,
        endpoint: endpointKey,
        status: result.status,
      });
      continue;
    }

    const reasons = parseMetrcPackageAdjustmentReasonsPayload(result.data);
    const selectedReason = pickFirstActivePackageAdjustmentReason(reasons);
    if (!selectedReason) {
      attempts.push({
        endpoint: endpointKey,
        httpStatus: result.status,
        response: result.data,
      });
      logWarn("[METRC] package_adjustment_reasons_empty", {
        companyId: input.companyId,
        endpoint: endpointKey,
        parsedCount: reasons.length,
      });
      continue;
    }

    logInfo("[METRC] package_adjustment_reasons_resolved", {
      companyId: input.companyId,
      endpoint: endpointKey,
      selectedReason: selectedReason.name,
      count: reasons.length,
    });

    return {
      ok: true,
      licenseNumber: license,
      endpoint: endpointKey,
      attemptedEndpoints: candidates.map((p) => p.split("?")[0] || p),
      reasons,
      selectedReason,
      rawResponse: result.data,
    };
  }

  return {
    ok: false,
    message: "No valid package adjustment reason found",
    licenseNumber: license,
    attemptedEndpoints: candidates.map((p) => p.split("?")[0] || p),
    attempts,
  };
}

export async function getMetrcPackageAdjustmentReasons(
  companyId: string,
  licenseNumber: string,
): Promise<MetrcPackageAdjustmentReasonsResult> {
  const loaded = await loadCompanyMetrcConfig(companyId);
  if (!loaded) {
    return {
      ok: false,
      message: "Company configuration not found.",
      licenseNumber: String(licenseNumber || "").trim(),
      attemptedEndpoints: buildPackageAdjustmentReasonsPathCandidates(licenseNumber).map(
        (p) => p.split("?")[0] || p,
      ),
      attempts: [],
    };
  }

  if (!loaded.userApiKey) {
    return {
      ok: false,
      message: "User API key is required to fetch package adjustment reasons.",
      licenseNumber: String(licenseNumber || "").trim(),
      attemptedEndpoints: buildPackageAdjustmentReasonsPathCandidates(licenseNumber).map(
        (p) => p.split("?")[0] || p,
      ),
      attempts: [],
    };
  }

  const client = MetrcClient.fromLoadedConfig(loaded, companyId);
  return fetchMetrcPackageAdjustmentReasons({
    client,
    companyId,
    licenseNumber,
    loaded,
  });
}
