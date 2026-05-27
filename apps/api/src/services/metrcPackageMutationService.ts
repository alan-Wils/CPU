import { logInfo, logWarn } from "../lib/logger.js";
import { MetrcClient, isMetrcClientFailure } from "../lib/metrcClient.js";
import { loadCompanyMetrcConfig } from "../lib/metrcConfigLoader.js";
import { buildMetrcCredentialHintFromLoaded } from "../lib/metrcCredentialDiagnostics.js";
import { metrcPullFailureMessage } from "../lib/metrcEndpoints.js";
import { fetchMetrcPackageAdjustmentReasons } from "./metrcPackageAdjustmentReasonsService.js";
import type { MetrcPackageAdjustmentReasonsResult } from "./metrcPackageAdjustmentReasonsService.js";
import {
  buildMetrcPackageAdjustBody,
  buildMetrcPackageChangeItemBody,
  buildMetrcPackageFinishBody,
  buildMetrcPackageUnfinishBody,
} from "../lib/metrcPackageMutationBodies.js";
import { refreshEvaluationPackageFromMetrc } from "../lib/metrcPackageLiveRefresh.js";
import {
  buildEvaluationPackageSelectionDiagnostics,
  isPackageQuantityEmpty,
  MetrcEvaluationPackageNotFoundError,
  resolveEvaluationAdjustQuantity,
  resolveMetrcEvaluationPackage,
  resolvePackageUnitOfMeasure,
  type MetrcEvaluationPackageResolveKind,
  type ResolvedMetrcEvaluationPackage,
} from "../lib/metrcPackageResolve.js";
import {
  buildFinishPackageIdempotentSpreadsheetFields,
  isMetrcPackageAlreadyFinishedMessage,
  type FinishPackageIdempotentResult,
} from "../lib/metrcPackageFinishIdempotency.js";
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
  resolvedAdjustmentReason?: string | null,
): unknown[] {
  switch (kind) {
    case "change_item":
      return buildMetrcPackageChangeItemBody({ packageLabel: pkg.packageLabel, itemName });
    case "adjust": {
      const quantity = resolveEvaluationAdjustQuantity(pkg);
      const unitOfMeasure = resolvePackageUnitOfMeasure({
        persistedUnitOfMeasure: pkg.unitOfMeasure,
        raw: pkg.raw,
      });
      const adjustmentReason = String(resolvedAdjustmentReason || "").trim();
      return buildMetrcPackageAdjustBody({
        packageLabel: pkg.packageLabel,
        quantity,
        unitOfMeasure,
        adjustmentReason,
        adjustmentDate: String(input.adjustmentDate || "").trim() || todayYmd(),
        reasonNote: input.reasonNote ?? "NexBatch evaluation",
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

  private async completeFinishPackageIdempotent(input: {
    companyId: string;
    actorUserId: string;
    license: string;
    pkg: ResolvedMetrcEvaluationPackage;
    pathname: string;
    endpointKey: string;
    finalRequestBody: unknown;
    startedAt: number;
    evaluationMutationMeta: Record<string, unknown>;
    mutationRequestExtras: Record<string, unknown>;
    result: FinishPackageIdempotentResult;
    skippedMetrcCall: boolean;
    metrcHttpStatus?: number;
    metrcRawResponse?: unknown;
  }): Promise<MetrcPackageMutationSuccess> {
    const durationMs = Date.now() - input.startedAt;
    const syncResult = await this.packagesSyncService.syncMetrcPackages({
      companyId: input.companyId,
      actorUserId: input.actorUserId,
    });
    const packagesSynced =
      syncResult.ok === true ? syncResult.count ?? syncResult.packages?.length ?? 0 : 0;

    const spreadsheetFields = buildFinishPackageIdempotentSpreadsheetFields({
      licenseNumber: input.license,
      packageId: input.pkg.packageId,
      packageLabel: input.pkg.packageLabel,
      requestBody: input.finalRequestBody,
      result: input.result,
    });

    const responsePayload = attachSpreadsheetFieldsToResponse(
      {
        ok: true,
        idempotent: true,
        alreadyFinished: true,
        message:
          input.result === "Package already finished"
            ? "Package already finished."
            : "Package already finished in METRC.",
        ...(input.metrcHttpStatus != null ? { metrcHttpStatus: input.metrcHttpStatus } : {}),
        metrcResponse:
          input.metrcRawResponse ??
          (input.skippedMetrcCall
            ? { skippedMetrcCall: true, alreadyFinished: true }
            : { alreadyFinished: true }),
        packagesSynced,
        packageSource: input.pkg.source,
        isFinishedAfter: true,
        skippedMetrcCall: input.skippedMetrcCall,
        ...input.evaluationMutationMeta,
      },
      spreadsheetFields,
    );

    await appendMetrcPackageRequestLog({
      companyId: input.companyId,
      action: "evaluation_finish",
      method: input.skippedMetrcCall ? "SKIP" : "PUT",
      endpoint: input.endpointKey,
      httpStatus: input.metrcHttpStatus ?? 200,
      requestPayload: {
        pathname: input.pathname,
        body: input.finalRequestBody,
        ...input.mutationRequestExtras,
      },
      responsePayload,
      durationMs,
      actorUserId: input.actorUserId,
    });

    logInfo("[METRC] package_finish_idempotent_success", {
      companyId: input.companyId,
      packageLabel: input.pkg.packageLabel,
      result: input.result,
      skippedMetrcCall: input.skippedMetrcCall,
      metrcHttpStatus: input.metrcHttpStatus ?? null,
    });

    return {
      ok: true,
      status: 200,
      message:
        input.result === "Package already finished"
          ? "Finish Package: package already finished (desired state)."
          : "Finish Package: package already finished in METRC (desired state).",
      endpoint: input.endpointKey,
      requestPayload: {
        pathname: input.pathname,
        body: input.finalRequestBody,
        ...input.mutationRequestExtras,
      },
      responsePayload,
      durationMs,
      packagesSynced,
      packageLabel: input.pkg.packageLabel,
      packageId: input.pkg.packageId,
      licenseNumber: input.license,
      spreadsheetFields,
    };
  }

  private async syncAndResolveEvaluationPackage(input: {
    companyId: string;
    actorUserId: string;
    packageLabel?: string | null;
    packageId?: string | null;
    licenseNumber?: string | null;
    kind: MetrcEvaluationPackageResolveKind;
  }): Promise<ResolvedMetrcEvaluationPackage> {
    await this.packagesSyncService.syncMetrcPackages({
      companyId: input.companyId,
      actorUserId: input.actorUserId,
    });
    return resolveMetrcEvaluationPackage({
      companyId: input.companyId,
      packageLabel: input.packageLabel,
      packageId: input.packageId,
      licenseNumber: input.licenseNumber,
      kind: input.kind,
    });
  }

  private async refreshEvaluationPackageState(input: {
    companyId: string;
    actorUserId: string;
    client: MetrcClient;
    licenseNumber: string;
    pkg: ResolvedMetrcEvaluationPackage;
    packageLabel?: string | null;
    packageId?: string | null;
    licenseOverride?: string | null;
    kind: MetrcEvaluationPackageResolveKind;
  }): Promise<ResolvedMetrcEvaluationPackage> {
    const synced = await this.syncAndResolveEvaluationPackage({
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      packageLabel: input.packageLabel,
      packageId: input.packageId,
      licenseNumber: input.licenseOverride,
      kind: input.kind,
    });
    return refreshEvaluationPackageFromMetrc({
      client: input.client,
      licenseNumber: input.licenseNumber,
      pkg: synced,
    });
  }

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

    let pkg: ResolvedMetrcEvaluationPackage;
    try {
      pkg = await resolveMetrcEvaluationPackage({
        companyId: input.companyId,
        packageLabel: input.packageLabel,
        packageId: input.packageId,
        licenseNumber: input.licenseNumber ?? loaded.licenseNumber,
        kind: input.kind,
      });
    } catch (err) {
      if (err instanceof MetrcEvaluationPackageNotFoundError) {
        return { ok: false, status: 400, message: err.message };
      }
      throw err;
    }

    const packageSelectionDiagnostics = buildEvaluationPackageSelectionDiagnostics(pkg);

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

    let packageResolvedBeforeMutation: ResolvedMetrcEvaluationPackage | null = null;
    if (input.kind === "adjust" || input.kind === "finish" || input.kind === "unfinish") {
      pkg = await this.refreshEvaluationPackageState({
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        client,
        licenseNumber: license,
        pkg,
        packageLabel: input.packageLabel,
        packageId: input.packageId,
        licenseOverride: input.licenseNumber ?? pkg.licenseNumber ?? loaded.licenseNumber,
        kind: input.kind,
      });
      packageResolvedBeforeMutation = pkg;
      logInfo("[METRC] package_mutation_reresolved_after_sync", {
        companyId: input.companyId,
        kind: input.kind,
        packageLabel: pkg.packageLabel,
        quantity: pkg.quantity,
        unitOfMeasure: pkg.unitOfMeasure,
        isFinished: pkg.isFinished,
      });
    }

    let adjustmentReasonsResult: MetrcPackageAdjustmentReasonsResult | null = null;
    if (input.kind === "adjust") {
      adjustmentReasonsResult = await fetchMetrcPackageAdjustmentReasons({
        client,
        companyId: input.companyId,
        licenseNumber: license,
        loaded,
      });
      if (adjustmentReasonsResult.ok === false) {
        return {
          ok: false,
          status: 400,
          message: adjustmentReasonsResult.message,
          endpoint: adjustmentReasonsResult.attemptedEndpoints[0] ?? "/packages/v2/adjust/reasons",
          requestPayload: {
            package: pkg,
            adjustmentReasonLookup: {
              attemptedEndpoints: adjustmentReasonsResult.attemptedEndpoints,
              attempts: adjustmentReasonsResult.attempts,
            },
          },
          responsePayload: {
            ok: false,
            message: adjustmentReasonsResult.message,
            attemptedEndpoints: adjustmentReasonsResult.attemptedEndpoints,
            attempts: adjustmentReasonsResult.attempts,
          },
        };
      }
    }

    const requestBody = buildRequestBody(
      input.kind,
      pkg,
      input,
      itemName,
      adjustmentReasonsResult?.ok === true ? adjustmentReasonsResult.selectedReason.name : null,
    );

    const adjustmentReasonMeta =
      adjustmentReasonsResult?.ok === true
        ? {
            endpoint: adjustmentReasonsResult.endpoint,
            selectedAdjustmentReason: adjustmentReasonsResult.selectedReason.name,
            availableAdjustmentReasons: adjustmentReasonsResult.reasons.map((r) => r.name),
            attemptedEndpoints: adjustmentReasonsResult.attemptedEndpoints,
          }
        : null;

    const adjustRow =
      input.kind === "adjust"
        ? ((requestBody as { Quantity?: number; UnitOfMeasure?: string; AdjustmentReason?: string }[])[0] ??
          null)
        : null;

    const evaluationMutationMeta = {
      ...packageSelectionDiagnostics,
      ...(adjustmentReasonMeta ? { adjustmentReasonLookup: adjustmentReasonMeta } : {}),
      ...(packageResolvedBeforeMutation
        ? {
            packageResolvedBeforeMutation: {
              packageLabel: packageResolvedBeforeMutation.packageLabel,
              quantity: packageResolvedBeforeMutation.quantity,
              unitOfMeasure: packageResolvedBeforeMutation.unitOfMeasure,
              source: packageResolvedBeforeMutation.source,
            },
          }
        : {}),
      ...(input.kind === "adjust"
        ? {
            packageAdjustResolution: {
              quantityBefore: pkg.quantity,
              adjustDelta: adjustRow?.Quantity ?? null,
              targetQuantity: 0,
            },
          }
        : {}),
    };

    if (input.kind === "finish" && !isPackageQuantityEmpty(pkg.quantity)) {
      return {
        ok: false,
        status: 400,
        message: `Package ${pkg.packageLabel} cannot be finished because quantity is ${pkg.quantity} ${pkg.unitOfMeasure || ""}. Run Adjust Package first to zero the package.`,
        requestPayload: { package: pkg, ...evaluationMutationMeta },
        responsePayload: {
          ok: false,
          message: `Package is not empty (quantity ${pkg.quantity} ${pkg.unitOfMeasure || ""}).`,
          ...evaluationMutationMeta,
        },
      };
    }

    if (input.kind === "unfinish" && !pkg.isFinished) {
      return {
        ok: false,
        status: 400,
        message: `Package ${pkg.packageLabel} is not finished. Run Finish Package first, then retry Unfinish Package.`,
        requestPayload: { package: pkg, ...evaluationMutationMeta },
        responsePayload: {
          ok: false,
          message: "Package is not in a finished state.",
          ...evaluationMutationMeta,
        },
      };
    }

    const pathname = `${endpointForKind(input.kind)}${licenseQuery(license)}`;
    const endpointKey = pathname.split("?")[0] || pathname;
    const startedAt = Date.now();
    const mutationRequestExtras = { package: pkg, ...evaluationMutationMeta };

    if (input.kind === "finish" && pkg.isFinished) {
      return this.completeFinishPackageIdempotent({
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        license,
        pkg,
        pathname,
        endpointKey,
        finalRequestBody: requestBody,
        startedAt,
        evaluationMutationMeta,
        mutationRequestExtras,
        result: "Package already finished",
        skippedMetrcCall: true,
      });
    }

    if (input.kind === "adjust") {
      const unitOfMeasure = String(adjustRow?.UnitOfMeasure || "").trim();
      const adjustmentReason = String(adjustRow?.AdjustmentReason || "").trim();
      if (!unitOfMeasure) {
        return {
          ok: false,
          status: 400,
          message:
            "Package unit of measure could not be resolved. Sync packages first so UnitOfWeight is available.",
          requestPayload: { package: pkg, ...evaluationMutationMeta },
        };
      }
      if (!adjustmentReason) {
        return {
          ok: false,
          status: 400,
          message: "No valid package adjustment reason found",
          requestPayload: { package: pkg, ...evaluationMutationMeta },
        };
      }
    }

    let result = await client.put<unknown>(pathname, requestBody);
    let finalRequestBody = requestBody;
    let adjustAttempts = 1;

    if (input.kind === "adjust" && !isMetrcClientFailure(result)) {
      const maxAdjustAttempts = 2;
      while (adjustAttempts < maxAdjustAttempts) {
        pkg = await this.refreshEvaluationPackageState({
          companyId: input.companyId,
          actorUserId: input.actorUserId,
          client,
          licenseNumber: license,
          pkg,
          packageLabel: input.packageLabel,
          packageId: input.packageId,
          licenseOverride: input.licenseNumber ?? pkg.licenseNumber,
          kind: input.kind,
        });
        if (isPackageQuantityEmpty(pkg.quantity)) break;

        const retryBody = buildRequestBody(
          input.kind,
          pkg,
          input,
          itemName,
          adjustmentReasonsResult?.ok === true
            ? adjustmentReasonsResult.selectedReason.name
            : null,
        );
        const retryResult = await client.put<unknown>(pathname, retryBody);
        adjustAttempts += 1;
        finalRequestBody = retryBody;
        result = retryResult;
        if (isMetrcClientFailure(retryResult)) break;
      }

      pkg = await this.refreshEvaluationPackageState({
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        client,
        licenseNumber: license,
        pkg,
        packageLabel: input.packageLabel,
        packageId: input.packageId,
        licenseOverride: input.licenseNumber ?? pkg.licenseNumber,
        kind: input.kind,
      });

      if (!isPackageQuantityEmpty(pkg.quantity)) {
        return {
          ok: false,
          status: 400,
          message: `Adjust Package completed but quantity is still ${pkg.quantity} ${pkg.unitOfMeasure || ""}. METRC did not zero the package.`,
          endpoint: endpointKey,
          requestPayload: {
            pathname,
            body: finalRequestBody,
            package: pkg,
            ...evaluationMutationMeta,
            packageAdjustResolution: {
              quantityBefore: packageResolvedBeforeMutation?.quantity ?? null,
              adjustDelta: (finalRequestBody as { Quantity?: number }[])[0]?.Quantity ?? null,
              targetQuantity: 0,
              adjustAttempts,
              quantityAfter: pkg.quantity,
            },
          },
          responsePayload: {
            ok: false,
            message: `Package still has quantity ${pkg.quantity} after adjust.`,
            adjustAttempts,
            quantityAfter: pkg.quantity,
          },
        };
      }
    }

    if (isMetrcClientFailure(result)) {
      if (
        input.kind === "finish" &&
        isMetrcPackageAlreadyFinishedMessage(result.metrcMessage || result.message)
      ) {
        return this.completeFinishPackageIdempotent({
          companyId: input.companyId,
          actorUserId: input.actorUserId,
          license,
          pkg,
          pathname,
          endpointKey,
          finalRequestBody,
          startedAt,
          evaluationMutationMeta,
          mutationRequestExtras,
          result: "Already Finished",
          skippedMetrcCall: false,
          metrcHttpStatus: result.status,
          metrcRawResponse: {
            status: result.status,
            message: result.message,
            metrcMessage: result.metrcMessage,
            endpoint: result.endpoint,
            upstreamError: result.upstreamError,
          },
        });
      }

      const durationMs = Date.now() - startedAt;
      const message = metrcPullFailureMessage(result.status, result.metrcMessage || result.message);
      const spreadsheetFields = buildMetrcSpreadsheetFields({
        httpStatus: result.status,
        licenseNumber: license,
        packageId: pkg.packageId,
        packageLabel: pkg.packageLabel,
        requestBody: finalRequestBody,
        responsePayload: result,
      });

      await appendMetrcPackageRequestLog({
        companyId: input.companyId,
        action: `evaluation_${input.kind}`,
        method: "PUT",
        endpoint: endpointKey,
        httpStatus: result.status,
        requestPayload: { pathname, body: finalRequestBody, ...mutationRequestExtras },
        responsePayload: attachSpreadsheetFieldsToResponse(
          { error: message, metrcMessage: result.metrcMessage, ...evaluationMutationMeta },
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
        requestPayload: { pathname, body: finalRequestBody, ...mutationRequestExtras },
        responsePayload: attachSpreadsheetFieldsToResponse(
          { error: message, metrcMessage: result.metrcMessage, ...evaluationMutationMeta },
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
      requestBody: finalRequestBody,
      responsePayload: responseData,
    });

    const responsePayload = attachSpreadsheetFieldsToResponse(
      {
        ok: true,
        metrcResponse: responseData,
        packagesSynced,
        packageSource: pkg.source,
        quantityAfter: pkg.quantity,
        unitOfMeasureAfter: pkg.unitOfMeasure,
        isFinishedAfter: pkg.isFinished,
        ...(input.kind === "adjust" ? { adjustAttempts } : {}),
        ...evaluationMutationMeta,
      },
      spreadsheetFields,
    );

    await appendMetrcPackageRequestLog({
      companyId: input.companyId,
      action: `evaluation_${input.kind}`,
      method: "PUT",
      endpoint: endpointKey,
      httpStatus: result.status,
      requestPayload: { pathname, body: finalRequestBody, ...mutationRequestExtras },
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
      requestPayload: { pathname, body: finalRequestBody, ...mutationRequestExtras },
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
