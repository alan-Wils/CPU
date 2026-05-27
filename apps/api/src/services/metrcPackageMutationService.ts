import { logInfo, logWarn } from "../lib/logger.js";
import { MetrcClient, isMetrcClientFailure } from "../lib/metrcClient.js";
import { loadCompanyMetrcConfig } from "../lib/metrcConfigLoader.js";
import { buildMetrcCredentialHintFromLoaded } from "../lib/metrcCredentialDiagnostics.js";
import { metrcPullFailureMessage } from "../lib/metrcEndpoints.js";
import { resolveMetrcPackageAdjustmentReason } from "../lib/metrcPackageEvaluationDefaults.js";
import {
  buildMetrcPackageAdjustBody,
  buildMetrcPackageChangeItemBody,
  buildMetrcPackageFinishBody,
  buildMetrcPackageUnfinishBody,
} from "../lib/metrcPackageMutationBodies.js";
import {
  resolveMetrcEvaluationPackage,
  resolvePackageUnitOfMeasure,
} from "../lib/metrcPackageResolve.js";
import {
  attachSpreadsheetFieldsToResponse,
  buildMetrcSpreadsheetFields,
  type MetrcSpreadsheetFields,
} from "../lib/metrcSpreadsheetFields.js";
import { resolveMetrcLocationsActiveRequest } from "../lib/metrcLocationsActiveQuery.js";
import { isMetrcSandboxPlaceholderLicense } from "../lib/metrcOperationalStatus.js";
import { findMetrcItemByName, listMetrcItemsForCompany } from "../repositories/metrcItemRepository.js";
import { appendMetrcPackageRequestLog } from "../repositories/metrcPackageRepository.js";
import { MetrcPackagesSyncService } from "./metrcPackagesSyncService.js";

export type MetrcPackageMutationKind =
  | "change_item"
  | "adjust"
  | "finish"
  | "unfinish";

export type MetrcPackageMutationInput = {
  companyId: string;
  actorUserId: string;
  kind: MetrcPackageMutationKind;
  packageLabel?: string | null;
  packageId?: string | null;
  licenseNumber?: string | null;
  itemName?: string | null;
  quantity?: number | null;
  unitOfMeasure?: string | null;
  adjustmentReason?: string | null;
  adjustmentDate?: string | null;
  actualDate?: string | null;
  reasonNote?: string | null;
};

export type MetrcPackageMutationSuccess = {
  ok: true;
  status: number;
  message: string;
  endpoint: string;
  requestPayload: unknown;
  responsePayload: unknown;
  durationMs: number;
  packagesSynced: number;
  packageLabel: string;
  packageId: string | null;
  licenseNumber: string;
  spreadsheetFields: MetrcSpreadsheetFields;
};

export type MetrcPackageMutationFailure = {
  ok: false;
  status: number;
  message: string;
  credentialHint?: string;
  endpoint?: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  metrcMessage?: string;
  spreadsheetFields?: MetrcSpreadsheetFields;
};

export type MetrcPackageMutationResponse =
  | MetrcPackageMutationSuccess
  | MetrcPackageMutationFailure;

function licenseQuery(licenseNumber: string): string {
  const license = String(licenseNumber || "").trim();
  return license ? `?licenseNumber=${encodeURIComponent(license)}` : "";
}

function endpointForKind(kind: MetrcPackageMutationKind): string {
  switch (kind) {
    case "change_item":
      return "/packages/v2/item";
    case "adjust":
      return "/packages/v2/adjust";
    case "finish":
      return "/packages/v2/finish";
    case "unfinish":
      return "/packages/v2/unfinish";
    default:
      return "/packages/v2";
  }
}

function actionLabel(kind: MetrcPackageMutationKind): string {
  switch (kind) {
    case "change_item":
      return "Change Package Item";
    case "adjust":
      return "Adjust Package";
    case "finish":
      return "Finish Package";
    case "unfinish":
      return "Unfinish Package";
    default:
      return "Package mutation";
  }
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

async function resolveItemNameForChange(
  companyId: string,
  pkg: { itemName: string },
  requestedItemName?: string | null,
): Promise<{ ok: true; itemName: string } | { ok: false; status: number; message: string }> {
  const explicit = String(requestedItemName || "").trim();
  if (explicit) {
    const row = await findMetrcItemByName(companyId, explicit);
    if (row) return { ok: true, itemName: row.itemName.trim() || explicit };
    return { ok: true, itemName: explicit };
  }

  const current = String(pkg.itemName || "").trim();
  const items = await listMetrcItemsForCompany(companyId);
  const alternate = items.find((row) => row.itemName.trim() && row.itemName.trim() !== current);
  if (alternate?.itemName.trim()) {
    return { ok: true, itemName: alternate.itemName.trim() };
  }
  if (current) return { ok: true, itemName: current };

  if (items[0]?.itemName.trim()) {
    return { ok: true, itemName: items[0].itemName.trim() };
  }

  return {
    ok: false,
    status: 400,
    message: "METRC item is required for change item. Sync items first.",
  };
}

function buildRequestBody(
  kind: MetrcPackageMutationKind,
  pkg: Awaited<ReturnType<typeof resolveMetrcEvaluationPackage>>,
  input: MetrcPackageMutationInput,
  itemName: string,
): unknown[] {
  switch (kind) {
    case "change_item":
      return buildMetrcPackageChangeItemBody({ packageLabel: pkg.packageLabel, itemName });
    case "adjust": {
      const quantity =
        input.quantity != null && Number.isFinite(Number(input.quantity))
          ? Number(input.quantity)
          : 0;
      const unitOfMeasure = resolvePackageUnitOfMeasure({
        persistedUnitOfMeasure: pkg.unitOfMeasure,
        raw: pkg.raw,
      });
      return buildMetrcPackageAdjustBody({
        packageLabel: pkg.packageLabel,
        quantity,
        unitOfMeasure,
        adjustmentReason: resolveMetrcPackageAdjustmentReason(input.adjustmentReason),
        adjustmentDate: String(input.adjustmentDate || "").trim() || todayYmd(),
        reasonNote: input.reasonNote ?? "NexBatch evaluation adjust",
      });
    }
    case "finish":
      return buildMetrcPackageFinishBody({
        packageLabel: pkg.packageLabel,
        actualDate: String(input.actualDate || "").trim() || todayYmd(),
      });
    case "unfinish":
      return buildMetrcPackageUnfinishBody({ packageLabel: pkg.packageLabel });
    default:
      return [];
  }
}

export class MetrcPackageMutationService {
  packagesSyncService = new MetrcPackagesSyncService();

  async runPackageMutation(
    input: MetrcPackageMutationInput,
  ): Promise<MetrcPackageMutationResponse> {
    const label = actionLabel(input.kind);
    logInfo("[METRC] package_mutation_start", {
      companyId: input.companyId,
      kind: input.kind,
    });

    const loaded = await loadCompanyMetrcConfig(input.companyId);
    if (!loaded) {
      return { ok: false, status: 404, message: "Company configuration not found." };
    }

    if (loaded.environment !== "sandbox") {
      return {
        ok: false,
        status: 403,
        message: `${label} is sandbox-only. Switch METRC environment to sandbox.`,
      };
    }

    if (!loaded.userApiKey) {
      return {
        ok: false,
        status: 400,
        message: "User API key is required. Run sandbox setup or save a user key in Company Config.",
      };
    }

    const pkg = await resolveMetrcEvaluationPackage({
      companyId: input.companyId,
      packageLabel: input.packageLabel,
      packageId: input.packageId,
      licenseNumber: input.licenseNumber ?? loaded.licenseNumber,
    });

    let itemName = pkg.itemName;
    if (input.kind === "change_item") {
      const item = await resolveItemNameForChange(input.companyId, pkg, input.itemName);
      if (item.ok === false) {
        return { ok: false, status: item.status, message: item.message };
      }
      itemName = item.itemName;
    }

    let license = pkg.licenseNumber || String(loaded.licenseNumber || "").trim();
    if (!license) {
      return {
        ok: false,
        status: 400,
        message: "Facility license number is required for METRC package mutations.",
      };
    }

    const client = MetrcClient.fromLoadedConfig(loaded, input.companyId);
    if (isMetrcSandboxPlaceholderLicense(license)) {
      const locationsRequest = await resolveMetrcLocationsActiveRequest({
        client,
        loaded,
        companyId: input.companyId,
        purpose: `package_${input.kind}_test`,
      });
      license = locationsRequest.params.licenseNumber;
    }

    const requestBody = buildRequestBody(input.kind, pkg, input, itemName);

    if (input.kind === "adjust") {
      const adjustRow = (requestBody as { UnitOfMeasure?: string }[])[0];
      const unitOfMeasure = String(adjustRow?.UnitOfMeasure || "").trim();
      if (!unitOfMeasure) {
        return {
          ok: false,
          status: 400,
          message:
            "Package unit of measure could not be resolved. Sync packages first so UnitOfWeight is available.",
        };
      }
    }

    const pathname = `${endpointForKind(input.kind)}${licenseQuery(license)}`;
    const startedAt = Date.now();

    const result = await client.put<unknown>(pathname, requestBody);
    const endpointKey = pathname.split("?")[0] || pathname;

    if (isMetrcClientFailure(result)) {
      const durationMs = Date.now() - startedAt;
      const message = metrcPullFailureMessage(result.status, result.metrcMessage || result.message);
      const spreadsheetFields = buildMetrcSpreadsheetFields({
        httpStatus: result.status,
        licenseNumber: license,
        packageId: pkg.packageId,
        packageLabel: pkg.packageLabel,
        requestBody,
        responsePayload: result,
      });

      await appendMetrcPackageRequestLog({
        companyId: input.companyId,
        action: `evaluation_${input.kind}`,
        method: "PUT",
        endpoint: endpointKey,
        httpStatus: result.status,
        requestPayload: { pathname, body: requestBody, package: pkg },
        responsePayload: attachSpreadsheetFieldsToResponse(
          { error: message, metrcMessage: result.metrcMessage },
          spreadsheetFields,
        ),
        durationMs,
        actorUserId: input.actorUserId,
      });

      logWarn("[METRC] package_mutation_failed", {
        companyId: input.companyId,
        kind: input.kind,
        status: result.status,
        message,
      });

      return {
        ok: false,
        status: result.status || 502,
        message,
        credentialHint:
          result.status === 401 || result.status === 403
            ? buildMetrcCredentialHintFromLoaded(loaded)
            : undefined,
        endpoint: endpointKey,
        requestPayload: { pathname, body: requestBody, package: pkg },
        responsePayload: attachSpreadsheetFieldsToResponse(
          { error: message, metrcMessage: result.metrcMessage },
          spreadsheetFields,
        ),
        metrcMessage: result.metrcMessage,
        spreadsheetFields,
      };
    }

    const durationMs = Date.now() - startedAt;
    const syncResult = await this.packagesSyncService.syncMetrcPackages({
      companyId: input.companyId,
      actorUserId: input.actorUserId,
    });
    const packagesSynced =
      syncResult.ok === true ? syncResult.count ?? syncResult.packages?.length ?? 0 : 0;

    const responseData =
      result.data === undefined || result.data === null || result.data === ""
        ? { ok: true, metrcAccepted: true, httpStatus: result.status }
        : result.data;

    const spreadsheetFields = buildMetrcSpreadsheetFields({
      httpStatus: result.status,
      licenseNumber: license,
      packageId: pkg.packageId,
      packageLabel: pkg.packageLabel,
      requestBody,
      responsePayload: responseData,
    });

    const responsePayload = attachSpreadsheetFieldsToResponse(
      {
        ok: true,
        metrcResponse: responseData,
        packagesSynced,
        packageSource: pkg.source,
      },
      spreadsheetFields,
    );

    await appendMetrcPackageRequestLog({
      companyId: input.companyId,
      action: `evaluation_${input.kind}`,
      method: "PUT",
      endpoint: endpointKey,
      httpStatus: result.status,
      requestPayload: { pathname, body: requestBody, package: pkg },
      responsePayload,
      durationMs,
      actorUserId: input.actorUserId,
    });

    logInfo("[METRC] package_mutation_success", {
      companyId: input.companyId,
      kind: input.kind,
      packageLabel: pkg.packageLabel,
      packagesSynced,
      durationMs,
    });

    return {
      ok: true,
      status: result.status,
      message: `${label} submitted to METRC sandbox and packages re-synced.`,
      endpoint: endpointKey,
      requestPayload: { pathname, body: requestBody, package: pkg },
      responsePayload,
      durationMs,
      packagesSynced,
      packageLabel: pkg.packageLabel,
      packageId: pkg.packageId,
      licenseNumber: license,
      spreadsheetFields,
    };
  }

  changeItemTest(input: Omit<MetrcPackageMutationInput, "kind">) {
    return this.runPackageMutation({ ...input, kind: "change_item" });
  }

  adjustTest(input: Omit<MetrcPackageMutationInput, "kind">) {
    return this.runPackageMutation({ ...input, kind: "adjust" });
  }

  finishTest(input: Omit<MetrcPackageMutationInput, "kind">) {
    return this.runPackageMutation({ ...input, kind: "finish" });
  }

  unfinishTest(input: Omit<MetrcPackageMutationInput, "kind">) {
    return this.runPackageMutation({ ...input, kind: "unfinish" });
  }
}
