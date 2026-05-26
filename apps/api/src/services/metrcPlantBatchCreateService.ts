import { prisma } from "../config/prisma.js";
import { ConfigService } from "./configService.js";
import { logInfo, logWarn } from "../lib/logger.js";
import { MetrcClient, isMetrcClientFailure } from "../lib/metrcClient.js";
import { loadCompanyMetrcConfig } from "../lib/metrcConfigLoader.js";
import {
  buildMetrcCredentialHintFromLoaded,
  logMetrcCredentialDiagnostics,
} from "../lib/metrcCredentialDiagnostics.js";
import { metrcPullFailureMessage } from "../lib/metrcEndpoints.js";
import type { MetrcEnvironment } from "../lib/metrcResolveBaseUrl.js";
import {
  appendMetrcPlantBatchRequestLog,
  findMetrcPlantBatchByName,
  upsertMetrcPlantBatchesForCompany,
} from "../repositories/metrcPlantBatchRepository.js";
import type { NexbatchRoomSuite } from "../lib/metrcNexbatchRooms.js";

export type MetrcCreateTestPlantBatchInput = {
  companyId: string;
  actorUserId: string;
  name: string;
  strain: string;
  count: number;
  plantingDate: string;
  batchType?: "Clone" | "Seed";
  metrcLocationId?: string | null;
  nexbatchRoomSuite?: NexbatchRoomSuite | null;
  nexbatchRoomId?: string | null;
};

export type MetrcCreateTestPlantBatchSuccess = {
  ok: true;
  status: number;
  message: string;
  endpoint: string;
  requestPayload: unknown;
  responsePayload: unknown;
  durationMs: number;
  metrcPlantBatchId: string | null;
  plantBatch: {
    metrcPlantBatchId: string;
    metrcPlantBatchName: string;
    metrcLocationId: string;
    metrcStrainName: string;
    count: number;
    syncedAt: string;
  };
};

export type MetrcCreateTestPlantBatchFailure = {
  ok: false;
  status: number;
  message: string;
  credentialHint?: string;
  endpoint?: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  metrcMessage?: string;
};

export type MetrcCreateTestPlantBatchResponse =
  | MetrcCreateTestPlantBatchSuccess
  | MetrcCreateTestPlantBatchFailure;

function licenseQuery(licenseNumber: string): string {
  const license = String(licenseNumber || "").trim();
  return license ? `?licenseNumber=${encodeURIComponent(license)}` : "";
}

function buildCreatePathCandidates(licenseNumber: string): string[] {
  const q = licenseQuery(licenseNumber);
  return [
    `/plantbatches/v2/create${q}`,
    `/plantbatches/v2/plantings${q}`,
    `/plantbatches/v1/createplantings${q}`,
  ];
}

function buildMetrcCreateBody(input: {
  name: string;
  strain: string;
  count: number;
  locationName: string;
  plantingDate: string;
  batchType: "Clone" | "Seed";
}): unknown[] {
  return [
    {
      Name: input.name,
      Type: input.batchType,
      Count: input.count,
      Strain: input.strain,
      Location: input.locationName || null,
      Sublocation: null,
      PatientLicenseNumber: null,
      ActualDate: input.plantingDate,
      SourcePlantBatches: null,
    },
  ];
}

function extractCreatedPlantBatchId(response: unknown): string | null {
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

async function resolveLocationForCreate(input: MetrcCreateTestPlantBatchInput): Promise<
  | { ok: true; metrcLocationId: string; locationName: string }
  | { ok: false; status: number; message: string }
> {
  const explicitId = String(input.metrcLocationId || "").trim();
  if (explicitId) {
    const row = await prisma.metrcLocation.findFirst({
      where: { companyId: input.companyId, metrcLocationId: explicitId },
    });
    return {
      ok: true,
      metrcLocationId: explicitId,
      locationName: row?.name?.trim() || explicitId,
    };
  }

  const suite = input.nexbatchRoomSuite ?? null;
  const roomId = String(input.nexbatchRoomId || "").trim();
  if (!suite || !roomId) {
    return {
      ok: false,
      status: 400,
      message: "METRC location is required. Map a NexBatch room or provide metrcLocationId.",
    };
  }

  const mapped = await prisma.metrcLocation.findFirst({
    where: {
      companyId: input.companyId,
      nexbatchRoomSuite: suite,
      nexbatchRoomId: roomId,
    },
  });
  if (!mapped) {
    return {
      ok: false,
      status: 400,
      message:
        "No METRC location mapped to the selected NexBatch room. Sync locations and save room mapping first.",
    };
  }

  return {
    ok: true,
    metrcLocationId: mapped.metrcLocationId,
    locationName: mapped.name.trim() || mapped.metrcLocationId,
  };
}

export class MetrcPlantBatchCreateService {
  configService = new ConfigService();

  async createTestPlantBatch(
    input: MetrcCreateTestPlantBatchInput,
  ): Promise<MetrcCreateTestPlantBatchResponse> {
    logInfo("[METRC] plant_batch_create_test_start", {
      companyId: input.companyId,
      name: input.name,
    });

    const loaded = await loadCompanyMetrcConfig(input.companyId);
    if (!loaded) {
      return { ok: false, status: 404, message: "Company configuration not found." };
    }

    if (loaded.environment !== "sandbox") {
      return {
        ok: false,
        status: 403,
        message: "Create Test Plant Batch is sandbox-only. Switch METRC environment to sandbox.",
      };
    }

    if (!loaded.userApiKey) {
      return {
        ok: false,
        status: 400,
        message: "User API key is required. Run sandbox setup or save a user key in Company Config.",
      };
    }

    const license = String(loaded.licenseNumber || "").trim();
    if (!license) {
      return {
        ok: false,
        status: 400,
        message: "Facility license number is required for METRC plant batch creation.",
      };
    }

    const duplicate = await findMetrcPlantBatchByName(input.companyId, input.name);
    if (duplicate) {
      return {
        ok: false,
        status: 409,
        message: `A plant batch named "${input.name}" already exists in NexBatch (METRC id ${duplicate.metrcPlantBatchId}).`,
      };
    }

    const location = await resolveLocationForCreate(input);
    if (location.ok === false) {
      return { ok: false, status: location.status, message: location.message };
    }

    const batchType = input.batchType === "Seed" ? "Seed" : "Clone";
    const requestBody = buildMetrcCreateBody({
      name: input.name.trim(),
      strain: input.strain.trim(),
      count: input.count,
      locationName: location.locationName,
      plantingDate: input.plantingDate,
      batchType,
    });

    const client = MetrcClient.fromLoadedConfig(loaded, input.companyId);
    const candidates = buildCreatePathCandidates(license);
    const startedAt = Date.now();
    let lastStatus = 502;
    let lastMessage = "METRC plant batch create failed.";
    let lastEndpoint: string | undefined;
    let lastResponse: unknown = null;

    for (const pathname of candidates) {
      const result = await client.post<unknown>(pathname, requestBody);
      lastEndpoint = pathname.split("?")[0];

      if (!isMetrcClientFailure(result)) {
        const durationMs = Date.now() - startedAt;
        const syncedAt = new Date();
        const syncedAtIso = syncedAt.toISOString();
        const metrcPlantBatchId =
          extractCreatedPlantBatchId(result.data) ||
          `pending-${input.name.trim().toLowerCase().replace(/\s+/g, "-")}`;

        await upsertMetrcPlantBatchesForCompany(input.companyId, [
          {
            metrcPlantBatchId,
            licenseNumber: license,
            name: input.name.trim(),
            strainName: input.strain.trim(),
            metrcStrainId: null,
            count: input.count,
            metrcLocationId: location.metrcLocationId,
            locationName: location.locationName,
            plantedDate: new Date(`${input.plantingDate}T12:00:00.000Z`),
            lastModified: syncedAt,
            active: true,
            createdViaTest: true,
            rawPayloadJson: JSON.stringify(result.data ?? {}),
            lastSyncedAt: syncedAt,
          },
        ]);

        const logPayload = {
          companyId: input.companyId,
          action: "create_test",
          method: "POST",
          endpoint: lastEndpoint,
          httpStatus: result.status,
          requestPayload: { pathname, body: requestBody, location },
          responsePayload: result.data,
          durationMs,
          actorUserId: input.actorUserId,
        };
        await appendMetrcPlantBatchRequestLog(logPayload);

        logInfo("[METRC] plant_batch_create_test_success", {
          companyId: input.companyId,
          endpoint: lastEndpoint,
          status: result.status,
          metrcPlantBatchId,
        });

        return {
          ok: true,
          status: result.status,
          message: "Test plant batch submitted to METRC sandbox.",
          endpoint: lastEndpoint,
          requestPayload: { pathname, body: requestBody, location },
          responsePayload: result.data,
          durationMs,
          metrcPlantBatchId,
          plantBatch: {
            metrcPlantBatchId,
            metrcPlantBatchName: input.name.trim(),
            metrcLocationId: location.metrcLocationId,
            metrcStrainName: input.strain.trim(),
            count: input.count,
            syncedAt: syncedAtIso,
          },
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
    await appendMetrcPlantBatchRequestLog({
      companyId: input.companyId,
      action: "create_test",
      method: "POST",
      endpoint: lastEndpoint ?? "plantbatches/create",
      httpStatus: lastStatus,
      requestPayload: { body: requestBody, candidates },
      responsePayload: lastResponse,
      durationMs,
      actorUserId: input.actorUserId,
    });

    if (lastStatus === 401 || lastStatus === 403) {
      logMetrcCredentialDiagnostics({
        companyId: input.companyId,
        purpose: "plant_batch_create_test",
        userKeyLength: loaded.userApiKey.length,
        vendorKeyLength: loaded.vendorApiKey.length,
        licensePresent: Boolean(license),
      });
    }

    logWarn("[METRC] plant_batch_create_test_failed", {
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
