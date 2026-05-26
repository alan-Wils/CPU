import { logInfo, logWarn } from "../lib/logger.js";
import { MetrcClient, isMetrcClientFailure } from "../lib/metrcClient.js";
import { loadCompanyMetrcConfig } from "../lib/metrcConfigLoader.js";
import {
  buildMetrcCredentialHintFromLoaded,
  logMetrcCredentialDiagnostics,
} from "../lib/metrcCredentialDiagnostics.js";
import { metrcPullFailureMessage } from "../lib/metrcEndpoints.js";
import { resolveMetrcLocationsActiveRequest } from "../lib/metrcLocationsActiveQuery.js";
import { isMetrcSandboxPlaceholderLicense } from "../lib/metrcOperationalStatus.js";
import type { MetrcEnvironment } from "../lib/metrcResolveBaseUrl.js";
import {
  appendMetrcStrainRequestLog,
  findMetrcStrainByName,
  upsertMetrcStrainsForCompany,
} from "../repositories/metrcStrainRepository.js";
import type { MetrcStrainDto } from "./metrcStrainsSyncService.js";
import { MetrcStrainsSyncService } from "./metrcStrainsSyncService.js";

export const METRC_DEFAULT_TEST_STRAIN_NAME = "NexBatch Test Strain";

export type MetrcCreateTestStrainInput = {
  companyId: string;
  actorUserId: string;
  name: string;
  testingStatus?: string | null;
};

export type MetrcCreateTestStrainSuccess = {
  ok: true;
  status: number;
  message: string;
  alreadyExists: boolean;
  endpoint?: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  durationMs: number;
  metrcStrainId: string;
  strain: MetrcStrainDto;
};

export type MetrcCreateTestStrainFailure = {
  ok: false;
  status: number;
  message: string;
  credentialHint?: string;
  endpoint?: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  metrcMessage?: string;
};

export type MetrcCreateTestStrainResponse =
  | MetrcCreateTestStrainSuccess
  | MetrcCreateTestStrainFailure;

function licenseQuery(licenseNumber: string): string {
  const license = String(licenseNumber || "").trim();
  return license ? `?licenseNumber=${encodeURIComponent(license)}` : "";
}

function buildCreatePathCandidates(licenseNumber: string): string[] {
  const q = licenseQuery(licenseNumber);
  return [`/strains/v2/create${q}`, `/strains/v1/create${q}`];
}

function normalizeTestingStatus(raw: string | null | undefined): string {
  const trimmed = String(raw ?? "").trim();
  return trimmed || "None";
}

function buildMetrcCreateStrainBody(input: { name: string; testingStatus: string }): unknown[] {
  return [
    {
      Name: input.name,
      TestingStatus: input.testingStatus,
      ThcLevel: null,
      CbdLevel: null,
      IndicaPercentage: null,
      SativaPercentage: null,
    },
  ];
}

function extractCreatedStrainId(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const data = response as Record<string, unknown>;
  const ids = data.Ids ?? data.ids;
  if (Array.isArray(ids) && ids.length > 0) {
    return String(ids[0] ?? "").trim() || null;
  }
  const id = data.Id ?? data.id;
  if (id !== undefined && id !== null) return String(id).trim() || null;
  return null;
}

function rowToDto(
  row: NonNullable<Awaited<ReturnType<typeof findMetrcStrainByName>>>,
  nexbatchStrainLabel: string | null,
): MetrcStrainDto {
  return {
    metrcStrainId: row.metrcStrainId,
    name: row.name,
    testingStatus: row.testingStatus,
    active: row.active,
    archived: row.archived,
    lastModified: row.lastModified ? row.lastModified.toISOString() : null,
    licenseNumber: row.licenseNumber,
    nexbatchStrainId: row.nexbatchStrainId,
    nexbatchStrainLabel,
  };
}

export class MetrcStrainCreateService {
  strainsSyncService = new MetrcStrainsSyncService();

  async createTestStrain(input: MetrcCreateTestStrainInput): Promise<MetrcCreateTestStrainResponse> {
    const strainName = String(input.name || "").trim();
    const testingStatus = normalizeTestingStatus(input.testingStatus);

    logInfo("[METRC] strain_create_test_start", {
      companyId: input.companyId,
      name: strainName,
    });

    if (!strainName) {
      return { ok: false, status: 400, message: "Strain name is required." };
    }

    const loaded = await loadCompanyMetrcConfig(input.companyId);
    if (!loaded) {
      return { ok: false, status: 404, message: "Company configuration not found." };
    }

    if (loaded.environment !== "sandbox") {
      return {
        ok: false,
        status: 403,
        message: "Create Test Strain is sandbox-only. Switch METRC environment to sandbox.",
      };
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
        message: "Facility license number is required for METRC strain creation.",
      };
    }

    const existing = await findMetrcStrainByName(input.companyId, strainName);
    if (existing) {
      const cultivation = await this.strainsSyncService.loadCultivationConfig(input.companyId);
      const { parseNexbatchStrainsFromCultivationValue, findNexbatchStrainLabel } = await import(
        "../lib/metrcNexbatchStrains.js"
      );
      const nexbatchStrains = parseNexbatchStrainsFromCultivationValue(cultivation);
      const strain = rowToDto(existing, findNexbatchStrainLabel(nexbatchStrains, existing.nexbatchStrainId));

      await appendMetrcStrainRequestLog({
        companyId: input.companyId,
        action: "create_test_dedupe",
        method: "POST",
        endpoint: "strains/create",
        httpStatus: 200,
        requestPayload: { name: strainName, testingStatus, skipped: true },
        responsePayload: { alreadyExists: true, metrcStrainId: existing.metrcStrainId },
        durationMs: 0,
        actorUserId: input.actorUserId,
      });

      logInfo("[METRC] strain_create_test_dedupe", {
        companyId: input.companyId,
        metrcStrainId: existing.metrcStrainId,
      });

      return {
        ok: true,
        status: 200,
        message: `Strain "${strainName}" already exists in NexBatch — using existing record.`,
        alreadyExists: true,
        durationMs: 0,
        metrcStrainId: existing.metrcStrainId,
        strain,
      };
    }

    const client = MetrcClient.fromLoadedConfig(loaded, input.companyId);
    if (isMetrcSandboxPlaceholderLicense(license)) {
      const locationsRequest = await resolveMetrcLocationsActiveRequest({
        client,
        loaded,
        companyId: input.companyId,
        purpose: "strain_create_test",
      });
      license = locationsRequest.params.licenseNumber;
    }

    const requestBody = buildMetrcCreateStrainBody({ name: strainName, testingStatus });
    const candidates = buildCreatePathCandidates(license);
    const startedAt = Date.now();
    let lastStatus = 502;
    let lastMessage = "METRC strain create failed.";
    let lastEndpoint: string | undefined;
    let lastResponse: unknown = null;

    for (const pathname of candidates) {
      const result = await client.post<unknown>(pathname, requestBody);
      lastEndpoint = pathname.split("?")[0];

      if (!isMetrcClientFailure(result)) {
        const durationMs = Date.now() - startedAt;
        const syncedAt = new Date();
        const syncedAtIso = syncedAt.toISOString();
        const metrcStrainId =
          extractCreatedStrainId(result.data) ||
          `pending-${strainName.toLowerCase().replace(/\s+/g, "-")}`;

        await upsertMetrcStrainsForCompany(input.companyId, [
          {
            metrcStrainId,
            licenseNumber: license,
            name: strainName,
            testingStatus,
            active: true,
            archived: false,
            lastModified: syncedAt,
            rawPayloadJson: JSON.stringify(result.data ?? {}),
            nexbatchStrainId: null,
            lastSyncedAt: syncedAt,
          },
        ]);

        const logPayload = {
          companyId: input.companyId,
          action: "create_test",
          method: "POST",
          endpoint: lastEndpoint,
          httpStatus: result.status,
          requestPayload: { pathname, body: requestBody, licenseNumber: license },
          responsePayload: result.data,
          durationMs,
          actorUserId: input.actorUserId,
        };
        await appendMetrcStrainRequestLog(logPayload);

        const syncResult = await this.strainsSyncService.syncMetrcStrains({
          companyId: input.companyId,
          actorUserId: input.actorUserId,
        });

        let strain: MetrcStrainDto;
        if (syncResult.ok) {
          strain =
            syncResult.strains.find(
              (s) => s.metrcStrainId === metrcStrainId || s.name.trim().toLowerCase() === strainName.toLowerCase(),
            ) ?? {
              metrcStrainId,
              name: strainName,
              testingStatus,
              active: true,
              archived: false,
              lastModified: syncedAtIso,
              licenseNumber: license,
              nexbatchStrainId: null,
              nexbatchStrainLabel: null,
            };
        } else {
          strain = {
            metrcStrainId,
            name: strainName,
            testingStatus,
            active: true,
            archived: false,
            lastModified: syncedAtIso,
            licenseNumber: license,
            nexbatchStrainId: null,
            nexbatchStrainLabel: null,
          };
        }

        logInfo("[METRC] strain_create_test_success", {
          companyId: input.companyId,
          endpoint: lastEndpoint,
          status: result.status,
          metrcStrainId: strain.metrcStrainId,
          syncOk: syncResult.ok,
        });

        return {
          ok: true,
          status: result.status,
          message: syncResult.ok
            ? "Test strain created in METRC sandbox and strains re-synced."
            : "Test strain submitted to METRC sandbox. Strains sync did not complete — run Sync Strains.",
          alreadyExists: false,
          endpoint: lastEndpoint,
          requestPayload: logPayload.requestPayload,
          responsePayload: result.data,
          durationMs,
          metrcStrainId: strain.metrcStrainId,
          strain,
        };
      }

      lastStatus = result.status || 502;
      lastMessage = metrcPullFailureMessage(lastStatus, result.metrcMessage || result.message);
      lastResponse = {
        status: result.status,
        message: result.message,
        metrcMessage: result.metrcMessage,
        endpoint: result.endpoint,
        upstreamError: result.upstreamError,
        authAttempts: result.authAttempts,
      };

      if (result.status !== 404) break;
    }

    const durationMs = Date.now() - startedAt;
    await appendMetrcStrainRequestLog({
      companyId: input.companyId,
      action: "create_test",
      method: "POST",
      endpoint: lastEndpoint ?? "strains/create",
      httpStatus: lastStatus,
      requestPayload: { body: requestBody, candidates, licenseNumber: license },
      responsePayload: lastResponse,
      durationMs,
      actorUserId: input.actorUserId,
    });

    if (lastStatus === 401 || lastStatus === 403) {
      logMetrcCredentialDiagnostics({
        companyId: input.companyId,
        purpose: "strain_create_test",
        userKeyLength: loaded.userApiKey.length,
        vendorKeyLength: loaded.vendorApiKey.length,
        licensePresent: Boolean(license),
      });
    }

    logWarn("[METRC] strain_create_test_failed", {
      companyId: input.companyId,
      status: lastStatus,
      endpoint: lastEndpoint,
      message: lastMessage,
    });

    return {
      ok: false,
      status: lastStatus,
      message: lastMessage,
      credentialHint:
        lastStatus === 401 || lastStatus === 403
          ? buildMetrcCredentialHintFromLoaded(loaded)
          : undefined,
      endpoint: lastEndpoint,
      requestPayload: { body: requestBody, candidates },
      responsePayload: lastResponse,
      metrcMessage:
        lastResponse && typeof lastResponse === "object" && "metrcMessage" in lastResponse
          ? String((lastResponse as { metrcMessage?: unknown }).metrcMessage || "")
          : undefined,
    };
  }
}
