import { ConfigService } from "./configService.js";
import { logInfo, logWarn } from "../lib/logger.js";
import { MetrcClient, isMetrcClientFailure } from "../lib/metrcClient.js";
import { loadCompanyMetrcConfig } from "../lib/metrcConfigLoader.js";
import {
  buildMetrcCredentialHintFromLoaded,
  logMetrcCredentialDiagnostics,
} from "../lib/metrcCredentialDiagnostics.js";
import { metrcPullFailureMessage } from "../lib/metrcEndpoints.js";
import {
  applyMetrcOperationalSuccess,
  isMetrcSandboxPlaceholderLicense,
} from "../lib/metrcOperationalStatus.js";
import { resolveMetrcLocationsActiveRequest } from "../lib/metrcLocationsActiveQuery.js";
import {
  parseMetrcTransferTypesPayload,
  type ParsedMetrcTransferType,
} from "../lib/metrcTransferTypesParse.js";
import {
  listMetrcTransferTypesForCompany,
  replaceMetrcTransferTypesForCompany,
  type MetrcTransferTypeUpsertRow,
} from "../repositories/metrcTransferTypeRepository.js";

export const METRC_TRANSFER_TYPE_FALLBACK_NAMES = [
  "Wholesale Transfer",
  "Transfer",
  "Sales Delivery",
  "Internal Transfer",
  "Hub Transfer",
  "Wholesale",
  "Affiliated",
] as const;

function licenseQuery(licenseNumber: string): string {
  const license = String(licenseNumber || "").trim();
  return license ? `?licenseNumber=${encodeURIComponent(license)}` : "";
}

export function buildTransferTypesPathCandidates(licenseNumber: string): string[] {
  const q = licenseQuery(licenseNumber);
  return [
    `/transfers/v2/types${q}`,
    `/transfers/v1/types${q}`,
    `/transfertypes/v2${q}`,
    `/transfertypes/v1${q}`,
  ];
}

export type MetrcTransferTypeDto = {
  name: string;
  typeCode: string;
  licenseNumber: string;
  source: string;
  lastSyncedAt: string;
  raw: Record<string, unknown>;
};

export type MetrcTransferTypesSyncDiagnostics = {
  licenseNumber: string;
  endpoint: string | null;
  httpStatus: number | null;
  transferTypeOptionsCount: number;
  selectedTransferTypeName: string | null;
  firstRawTransferType: Record<string, unknown> | null;
  usedFallback: boolean;
  fallbackNames: string[];
};

export type MetrcTransferTypesSyncSuccess = {
  ok: true;
  syncedAt: string;
  count: number;
  transferTypes: MetrcTransferTypeDto[];
  usedFallback: boolean;
  diagnostics: MetrcTransferTypesSyncDiagnostics;
  durationMs: number;
  endpoint: string | null;
};

export type MetrcTransferTypesSyncFailure = {
  ok: false;
  status: number;
  message: string;
  credentialHint?: string;
  endpoint?: string;
  diagnostics?: MetrcTransferTypesSyncDiagnostics;
};

export type MetrcTransferTypesSyncResponse =
  | MetrcTransferTypesSyncSuccess
  | MetrcTransferTypesSyncFailure;

function dbRowToDto(row: Awaited<ReturnType<typeof listMetrcTransferTypesForCompany>>[number]): MetrcTransferTypeDto {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(row.rawPayloadJson || "{}") as Record<string, unknown>;
  } catch {
    raw = {};
  }
  return {
    name: row.name,
    typeCode: row.typeCode,
    licenseNumber: row.licenseNumber,
    source: row.source,
    lastSyncedAt: row.lastSyncedAt.toISOString(),
    raw,
  };
}

function parsedToUpsertRows(
  parsed: ParsedMetrcTransferType[],
  licenseNumber: string,
  source: string,
  syncedAt: Date,
): MetrcTransferTypeUpsertRow[] {
  return parsed.map((row) => ({
    name: row.name,
    typeCode: row.typeCode,
    licenseNumber,
    source,
    rawPayloadJson: JSON.stringify(row.raw),
    lastSyncedAt: syncedAt,
  }));
}

function fallbackParsed(): ParsedMetrcTransferType[] {
  return METRC_TRANSFER_TYPE_FALLBACK_NAMES.map((name) => ({
    name,
    typeCode: name,
    raw: { Name: name, source: "nexbatch_fallback" },
  }));
}

export class MetrcTransferTypesSyncService {
  configService = new ConfigService();

  async listSyncedTransferTypes(companyId: string): Promise<MetrcTransferTypeDto[]> {
    const rows = await listMetrcTransferTypesForCompany(companyId);
    return rows.map(dbRowToDto);
  }

  async syncMetrcTransferTypes(input: {
    companyId: string;
    actorUserId: string;
  }): Promise<MetrcTransferTypesSyncResponse> {
    logInfo("[METRC] transfer_types_sync_start", { companyId: input.companyId });

    const loaded = await loadCompanyMetrcConfig(input.companyId);
    if (!loaded) {
      return { ok: false, status: 404, message: "Company configuration not found." };
    }

    if (!loaded.userApiKey) {
      return {
        ok: false,
        status: 400,
        message: "User API key is required. Run sandbox setup or save a user key in Company Config.",
      };
    }

    let license = String(loaded.licenseNumber || "").trim();
    if (!license) {
      return {
        ok: false,
        status: 400,
        message: "Facility license number is required for METRC transfer types sync.",
      };
    }

    const client = MetrcClient.fromLoadedConfig(loaded, input.companyId);

    if (isMetrcSandboxPlaceholderLicense(license)) {
      const locationsRequest = await resolveMetrcLocationsActiveRequest({
        client,
        loaded,
        companyId: input.companyId,
        purpose: "transfer_types_sync",
      });
      license = locationsRequest.params.licenseNumber;
    }

    const startedAt = Date.now();
    const candidates = buildTransferTypesPathCandidates(license);
    let parsed: ParsedMetrcTransferType[] | null = null;
    let lastStatus: number | null = null;
    let lastMessage = "METRC transfer types sync failed.";
    let successEndpoint: string | null = null;

    for (const pathname of candidates) {
      const result = await client.get<unknown>(pathname);
      const endpointKey = pathname.split("?")[0] || pathname;

      if (!isMetrcClientFailure(result)) {
        parsed = parseMetrcTransferTypesPayload(result.data);
        lastStatus = result.status;
        successEndpoint = endpointKey;
        logInfo("[METRC] transfer_types_sync_endpoint_success", {
          companyId: input.companyId,
          endpoint: endpointKey,
          count: parsed.length,
        });
        break;
      }

      lastStatus = result.status || 502;
      lastMessage = metrcPullFailureMessage(lastStatus, result.metrcMessage || result.message);
      logWarn("[METRC] transfer_types_sync_endpoint_failed", {
        companyId: input.companyId,
        endpoint: endpointKey,
        status: lastStatus,
        message: lastMessage,
      });
    }

    const syncedAt = new Date();
    const syncedAtIso = syncedAt.toISOString();
    const durationMs = Date.now() - startedAt;
    let usedFallback = false;

    if (!parsed || parsed.length === 0) {
      usedFallback = true;
      parsed = fallbackParsed();
      logWarn("[METRC] transfer_types_sync_using_fallback", {
        companyId: input.companyId,
        licenseNumber: license,
        fallbackNames: METRC_TRANSFER_TYPE_FALLBACK_NAMES,
        lastStatus,
        lastMessage,
      });
    }

    const upsertRows = parsedToUpsertRows(parsed, license, usedFallback ? "fallback" : "metrc", syncedAt);
    await replaceMetrcTransferTypesForCompany(input.companyId, upsertRows);

    const diagnostics: MetrcTransferTypesSyncDiagnostics = {
      licenseNumber: license,
      endpoint: successEndpoint,
      httpStatus: lastStatus,
      transferTypeOptionsCount: parsed.length,
      selectedTransferTypeName: parsed[0]?.name ?? null,
      firstRawTransferType: parsed[0]?.raw ?? null,
      usedFallback,
      fallbackNames: usedFallback ? [...METRC_TRANSFER_TYPE_FALLBACK_NAMES] : [],
    };

    logInfo("[METRC] transfer_types_sync_diagnostics", {
      companyId: input.companyId,
      diagnostics,
    });

    if (!usedFallback && !successEndpoint) {
      if (lastStatus === 401 || lastStatus === 403) {
        logMetrcCredentialDiagnostics({
          companyId: input.companyId,
          purpose: "transfer_types_sync",
          userKeyLength: loaded.userApiKey.length,
          vendorKeyLength: loaded.vendorApiKey.length,
          licensePresent: Boolean(license),
        });
      }
      return {
        ok: false,
        status: lastStatus || 502,
        message: lastMessage,
        credentialHint:
          lastStatus === 401 || lastStatus === 403
            ? buildMetrcCredentialHintFromLoaded(loaded)
            : undefined,
        diagnostics,
      };
    }

    let nextMetrc = applyMetrcOperationalSuccess(
      {
        ...loaded.metrc,
        metrcSandboxLastTransferTypesSyncAt: syncedAtIso,
        metrcTransferTypesUsedFallback: usedFallback,
        metrcSandboxLastTransferTypesCount: parsed.length,
      },
      { operationalLicense: license, facilityName: null },
    );

    await this.configService.upsert({
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      key: "company",
      value: { ...loaded.company, metrc: nextMetrc },
    });

    const persisted = await listMetrcTransferTypesForCompany(input.companyId);
    const transferTypes = persisted.map(dbRowToDto);

    logInfo("[METRC] transfer_types_sync_success", {
      companyId: input.companyId,
      count: parsed.length,
      usedFallback,
      durationMs,
    });

    return {
      ok: true,
      syncedAt: syncedAtIso,
      count: parsed.length,
      transferTypes,
      usedFallback,
      diagnostics,
      durationMs,
      endpoint: successEndpoint,
    };
  }
}
