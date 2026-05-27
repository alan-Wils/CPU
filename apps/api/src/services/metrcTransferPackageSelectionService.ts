import { logInfo, logWarn } from "../lib/logger.js";
import { MetrcClient } from "../lib/metrcClient.js";
import { isPackageQuantityEmpty } from "../lib/metrcPackageStatus.js";
import { listEvaluationMutationPackageLabels } from "../lib/metrcEvaluationExcludedPackages.js";
import {
  buildTransferPackageSelectionMeta,
  refreshTransferablePackageSelection,
  resolveTransferableMetrcPackage,
  type TransferablePackageSelection,
} from "../lib/metrcPackageTransferResolve.js";
import { listMetrcItemsForCompany } from "../repositories/metrcItemRepository.js";
import { listMetrcHarvestsForCompany } from "../repositories/metrcHarvestRepository.js";
import { MetrcAvailablePackageTagsService } from "./metrcAvailablePackageTagsService.js";
import { MetrcPackageCreateService } from "./metrcPackageCreateService.js";
import { MetrcPackagesSyncService } from "./metrcPackagesSyncService.js";

export type EnsureTransferablePackageResult =
  | {
      ok: true;
      selection: TransferablePackageSelection;
      packageSelection: Record<string, unknown>;
      createdPackage: boolean;
    }
  | {
      ok: false;
      packageSelection: Record<string, unknown>;
      message: string;
    };

export class MetrcTransferPackageSelectionService {
  packagesSyncService = new MetrcPackagesSyncService();
  packageCreateService = new MetrcPackageCreateService();
  packageTagsService = new MetrcAvailablePackageTagsService();

  async ensureTransferablePackageForEvaluation(input: {
    companyId: string;
    actorUserId: string;
    licenseNumber: string;
    client: MetrcClient;
  }): Promise<EnsureTransferablePackageResult> {
    await this.packagesSyncService.syncMetrcPackages({
      companyId: input.companyId,
      actorUserId: input.actorUserId,
    });

    const excludedPackageLabels = await listEvaluationMutationPackageLabels(input.companyId);
    let createdPackage = false;

    let selection = await resolveTransferableMetrcPackage({
      companyId: input.companyId,
      licenseNumber: input.licenseNumber,
      excludedPackageLabels,
    });

    if (!selection) {
      const created = await this.createFreshSandboxPackage(input);
      if (!created.ok) {
        return {
          ok: false,
          message:
            "No transferable package found. Existing packages are finished, zero quantity, on hold, or already consumed by evaluation mutations. Run Create Package first.",
          packageSelection: buildTransferPackageSelectionMeta(null, input.licenseNumber),
        };
      }
      createdPackage = true;
      await this.packagesSyncService.syncMetrcPackages({
        companyId: input.companyId,
        actorUserId: input.actorUserId,
      });
      selection = await resolveTransferableMetrcPackage({
        companyId: input.companyId,
        licenseNumber: input.licenseNumber,
        excludedPackageLabels,
      });
      if (!selection) {
        return {
          ok: false,
          message:
            "No transferable package found after creating a sandbox package. Sync packages and retry.",
          packageSelection: buildTransferPackageSelectionMeta(null, input.licenseNumber),
        };
      }
      selection = {
        ...selection,
        selectionReason: "fresh_package_created_for_transfer",
      };
    }

    selection = await refreshTransferablePackageSelection({
      client: input.client,
      licenseNumber: input.licenseNumber,
      selection,
    });

    if (isPackageQuantityEmpty(selection.quantity)) {
      return {
        ok: false,
        message: `Selected package ${selection.packageLabel} still has zero quantity in METRC. Run Create Package with a fresh tag.`,
        packageSelection: buildTransferPackageSelectionMeta(selection, input.licenseNumber),
      };
    }

    const packageSelection = buildTransferPackageSelectionMeta(selection, input.licenseNumber);

    logInfo("[METRC] transfer_package_selected", {
      companyId: input.companyId,
      createdPackage,
      ...packageSelection,
    });

    return {
      ok: true,
      selection,
      packageSelection,
      createdPackage,
    };
  }

  private async createFreshSandboxPackage(input: {
    companyId: string;
    actorUserId: string;
    licenseNumber: string;
  }): Promise<{ ok: true; packageLabel: string } | { ok: false }> {
    const harvests = await listMetrcHarvestsForCompany(input.companyId);
    const harvest = [...harvests].sort(
      (a, b) => b.lastSyncedAt.getTime() - a.lastSyncedAt.getTime(),
    )[0];
    if (!harvest) {
      logWarn("[METRC] transfer_create_package_no_harvest", { companyId: input.companyId });
      return { ok: false };
    }

    const items = await listMetrcItemsForCompany(input.companyId);
    const item = items.find((row) => row.itemName.trim()) ?? items[0];
    if (!item) {
      logWarn("[METRC] transfer_create_package_no_item", { companyId: input.companyId });
      return { ok: false };
    }

    const tagsResult = await this.packageTagsService.fetchLabels({
      companyId: input.companyId,
      limit: 50,
    });
    if (tagsResult.ok !== true || !tagsResult.labels.length) {
      logWarn("[METRC] transfer_create_package_no_tags", { companyId: input.companyId });
      return { ok: false };
    }

    const excluded = new Set(await listEvaluationMutationPackageLabels(input.companyId));
    const packageTag =
      tagsResult.labels.find((label) => !excluded.has(label)) ?? tagsResult.labels[0];
    if (!packageTag || excluded.has(packageTag)) {
      return { ok: false };
    }

    const result = await this.packageCreateService.createTestPackage({
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      metrcHarvestId: harvest.metrcHarvestId,
      metrcItemId: item.metrcItemId,
      itemName: item.itemName,
      packageTag,
      quantity: 10,
      unitOfMeasure: item.unitOfMeasureName?.trim() || "Grams",
      packagedDate: new Date().toISOString().slice(0, 10),
      note: "NexBatch evaluation transfer package",
    });

    if (result.ok !== true) {
      logWarn("[METRC] transfer_create_package_failed", {
        companyId: input.companyId,
        message: result.message,
      });
      return { ok: false };
    }

    return { ok: true, packageLabel: result.packageLabel };
  }
}
