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
import {
  findMetrcItemByName,
  upsertMetrcItemsForCompany,
} from "../repositories/metrcItemRepository.js";
import type { MetrcItemDto } from "./metrcItemsSyncService.js";
import { MetrcItemsSyncService } from "./metrcItemsSyncService.js";

export const METRC_DEFAULT_TEST_ITEM_NAME = "NexBatch Test Item";
export const METRC_DEFAULT_TEST_ITEM_CATEGORY = "Buds";
export const METRC_DEFAULT_TEST_ITEM_UOM = "Grams";
export const METRC_DEFAULT_TEST_ITEM_QUANTITY_TYPE = "WeightBased";

export type MetrcCreateTestItemInput = {
  companyId: string;
  actorUserId: string;
  name: string;
  productCategory: string;
  unitOfMeasure: string;
  quantityType?: string | null;
  strainName?: string | null;
};

export type MetrcCreateTestItemSuccess = {
  ok: true;
  status: number;
  message: string;
  alreadyExists: boolean;
  endpoint?: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  durationMs: number;
  metrcItemId: string;
  item: MetrcItemDto;
};

export type MetrcCreateTestItemFailure = {
  ok: false;
  status: number;
  message: string;
  credentialHint?: string;
  endpoint?: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  metrcMessage?: string;
};

export type MetrcCreateTestItemResponse = MetrcCreateTestItemSuccess | MetrcCreateTestItemFailure;

function licenseQuery(licenseNumber: string): string {
  const license = String(licenseNumber || "").trim();
  return license ? `?licenseNumber=${encodeURIComponent(license)}` : "";
}

function buildCreatePathCandidates(licenseNumber: string): string[] {
  const q = licenseQuery(licenseNumber);
  return [`/items/v2/${q}`, `/items/v1/create${q}`];
}

export function buildMetrcCreateItemBody(input: {
  name: string;
  productCategory: string;
  unitOfMeasure: string;
  strainName?: string | null;
}): unknown[] {
  const strain = String(input.strainName || "").trim();
  return [
    {
      Name: input.name,
      ItemCategory: input.productCategory,
      ProductCategoryName: input.productCategory,
      UnitOfMeasure: input.unitOfMeasure,
      UnitOfMeasureName: input.unitOfMeasure,
      ...(strain ? { Strain: strain, StrainName: strain } : {}),
    },
  ];
}

function extractCreatedItemId(response: unknown): string | null {
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

export class MetrcItemCreateService {
  itemsSyncService = new MetrcItemsSyncService();

  async createTestItem(input: MetrcCreateTestItemInput): Promise<MetrcCreateTestItemResponse> {
    const itemName = String(input.name || "").trim();
    const productCategory = String(input.productCategory || "").trim();
    const unitOfMeasure = String(input.unitOfMeasure || "").trim();
    const quantityType = String(input.quantityType || METRC_DEFAULT_TEST_ITEM_QUANTITY_TYPE).trim();

    logInfo("[METRC] item_create_test_start", {
      companyId: input.companyId,
      name: itemName,
    });

    if (!itemName) {
      return { ok: false, status: 400, message: "Item name is required." };
    }
    if (!productCategory) {
      return { ok: false, status: 400, message: "Product category is required." };
    }
    if (!unitOfMeasure) {
      return { ok: false, status: 400, message: "Unit of measure is required." };
    }

    const loaded = await loadCompanyMetrcConfig(input.companyId);
    if (!loaded) {
      return { ok: false, status: 404, message: "Company configuration not found." };
    }

    if (loaded.environment !== "sandbox") {
      return {
        ok: false,
        status: 403,
        message: "Create Test Item is sandbox-only. Switch METRC environment to sandbox.",
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
        message: "Facility license number is required for METRC item creation.",
      };
    }

    const existing = await findMetrcItemByName(input.companyId, itemName);
    if (existing) {
      const item: MetrcItemDto = {
        metrcItemId: existing.metrcItemId,
        itemName: existing.itemName,
        categoryName: existing.categoryName,
        unitOfMeasureName: existing.unitOfMeasureName,
        quantityType: existing.quantityType,
        licenseNumber: existing.licenseNumber,
        lastSyncedAt: existing.lastSyncedAt.toISOString(),
      };
      return {
        ok: true,
        status: 200,
        message: `Item "${itemName}" already exists in NexBatch — using existing record.`,
        alreadyExists: true,
        durationMs: 0,
        metrcItemId: existing.metrcItemId,
        item,
      };
    }

    const client = MetrcClient.fromLoadedConfig(loaded, input.companyId);
    if (isMetrcSandboxPlaceholderLicense(license)) {
      const locationsRequest = await resolveMetrcLocationsActiveRequest({
        client,
        loaded,
        companyId: input.companyId,
        purpose: "item_create_test",
      });
      license = locationsRequest.params.licenseNumber;
    }

    const requestBody = buildMetrcCreateItemBody({
      name: itemName,
      productCategory,
      unitOfMeasure,
      strainName: input.strainName,
    });
    const candidates = buildCreatePathCandidates(license);
    const startedAt = Date.now();
    let lastStatus = 502;
    let lastMessage = "METRC item create failed.";
    let lastEndpoint: string | undefined;
    let lastResponse: unknown = null;

    for (const pathname of candidates) {
      const result = await client.post<unknown>(pathname, requestBody);
      lastEndpoint = pathname.split("?")[0];

      if (!isMetrcClientFailure(result)) {
        const durationMs = Date.now() - startedAt;
        const syncedAt = new Date();
        const syncedAtIso = syncedAt.toISOString();
        const metrcItemId =
          extractCreatedItemId(result.data) ||
          `pending-${itemName.toLowerCase().replace(/\s+/g, "-")}`;

        await upsertMetrcItemsForCompany(input.companyId, [
          {
            metrcItemId,
            licenseNumber: license,
            itemName,
            categoryName: productCategory,
            unitOfMeasureName: unitOfMeasure,
            quantityType,
            rawPayloadJson: JSON.stringify(result.data ?? {}),
            lastSyncedAt: syncedAt,
          },
        ]);

        const syncResult = await this.itemsSyncService.syncMetrcItems({
          companyId: input.companyId,
          actorUserId: input.actorUserId,
          licenseNumber: license,
        });

        let item: MetrcItemDto;
        if (syncResult.ok && syncResult.items.length > 0) {
          item =
            syncResult.items.find(
              (i) =>
                i.metrcItemId === metrcItemId ||
                i.itemName.trim().toLowerCase() === itemName.toLowerCase(),
            ) ?? syncResult.items[0]!;
        } else {
          item = {
            metrcItemId,
            itemName,
            categoryName: productCategory,
            unitOfMeasureName: unitOfMeasure,
            quantityType,
            licenseNumber: license,
            lastSyncedAt: syncedAtIso,
          };
        }

        logInfo("[METRC] item_create_test_success", {
          companyId: input.companyId,
          endpoint: lastEndpoint,
          status: result.status,
          metrcItemId: item.metrcItemId,
          syncOk: syncResult.ok,
        });

        return {
          ok: true,
          status: result.status,
          message: syncResult.ok
            ? "Test item created in METRC sandbox and items re-synced."
            : "Test item submitted to METRC sandbox. Items sync did not complete — run Sync Items.",
          alreadyExists: false,
          endpoint: lastEndpoint,
          requestPayload: { pathname, body: requestBody, licenseNumber: license },
          responsePayload: result.data,
          durationMs,
          metrcItemId: item.metrcItemId,
          item,
        };
      }

      lastStatus = result.status || 502;
      lastMessage = metrcPullFailureMessage(lastStatus, result.metrcMessage || result.message);
      lastResponse = result.upstreamError ?? null;
      logWarn("[METRC] item_create_test_attempt_failed", {
        companyId: input.companyId,
        endpoint: lastEndpoint,
        status: lastStatus,
        message: lastMessage,
      });
    }

    if (lastStatus === 401 || lastStatus === 403) {
      logMetrcCredentialDiagnostics({
        companyId: input.companyId,
        purpose: "item_create_test",
        userKeyLength: loaded.userApiKey.length,
        vendorKeyLength: loaded.vendorApiKey.length,
        licensePresent: Boolean(license),
      });
    }

    return {
      ok: false,
      status: lastStatus,
      message: lastMessage,
      credentialHint:
        lastStatus === 401 || lastStatus === 403
          ? buildMetrcCredentialHintFromLoaded(loaded)
          : undefined,
      endpoint: lastEndpoint,
      requestPayload: { body: requestBody, licenseNumber: license },
      responsePayload: lastResponse,
      metrcMessage: typeof lastResponse === "object" ? JSON.stringify(lastResponse) : undefined,
    };
  }
}
