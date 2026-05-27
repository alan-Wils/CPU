import { refreshEvaluationPackageFromMetrc } from "./metrcPackageLiveRefresh.js";
import { listEvaluationMutationPackageLabels } from "./metrcEvaluationExcludedPackages.js";
import {
  isPackageFinished,
  isPackageOnHold,
  isPackageQuantityEmpty,
  isPackageTransferable,
} from "./metrcPackageStatus.js";
import {
  resolvePackageUnitOfMeasure,
  resolveSyncedPackageQuantity,
} from "./metrcPackageResolve.js";
import { listMetrcPackagesForCompany } from "../repositories/metrcPackageRepository.js";
import type { MetrcClient } from "./metrcClient.js";

export type TransferablePackageSkipReason =
  | "license_mismatch"
  | "zero_quantity"
  | "finished"
  | "on_hold"
  | "evaluation_mutation_excluded";

export type SkippedTransferablePackage = {
  label: string;
  reason: TransferablePackageSkipReason;
  quantity: number;
};

export type TransferablePackageSelection = {
  packageLabel: string;
  packageId: string | null;
  licenseNumber: string;
  quantity: number;
  unitOfMeasure: string;
  lastSyncedAt: string;
  selectionReason: string;
  excludedPackageLabels: string[];
  skippedPackages: SkippedTransferablePackage[];
  raw: Record<string, unknown>;
};

function readPackageIdFromRaw(rawPayloadJson: string): string | null {
  try {
    const raw = JSON.parse(rawPayloadJson || "{}") as Record<string, unknown>;
    const id = raw.Id ?? raw.id;
    if (id === undefined || id === null) return null;
    const s = String(id).trim();
    return s || null;
  } catch {
    return null;
  }
}

function evaluatePackageRow(
  row: Awaited<ReturnType<typeof listMetrcPackagesForCompany>>[number],
  licenseNumber: string,
  excludedLabels: Set<string>,
): { transferable: TransferablePackageSelection | null; skipped: SkippedTransferablePackage | null } {
  const raw = (() => {
    try {
      return JSON.parse(row.rawPayloadJson || "{}") as Record<string, unknown>;
    } catch {
      return {};
    }
  })();

  const quantity = resolveSyncedPackageQuantity({ persistedQuantity: row.quantity, raw });
  const license = row.licenseNumber.trim();
  const label = row.packageLabel;

  if (excludedLabels.has(label)) {
    return {
      transferable: null,
      skipped: { label, reason: "evaluation_mutation_excluded", quantity },
    };
  }

  if (licenseNumber && license.toLowerCase() !== licenseNumber.toLowerCase()) {
    return {
      transferable: null,
      skipped: { label, reason: "license_mismatch", quantity },
    };
  }

  if (isPackageQuantityEmpty(quantity)) {
    return { transferable: null, skipped: { label, reason: "zero_quantity", quantity } };
  }

  if (isPackageFinished({ raw })) {
    return { transferable: null, skipped: { label, reason: "finished", quantity } };
  }

  if (isPackageOnHold({ raw })) {
    return { transferable: null, skipped: { label, reason: "on_hold", quantity } };
  }

  if (!isPackageTransferable({ quantity, raw })) {
    return { transferable: null, skipped: { label, reason: "zero_quantity", quantity } };
  }

  return {
    transferable: {
      packageLabel: label,
      packageId: readPackageIdFromRaw(row.rawPayloadJson),
      licenseNumber: license,
      quantity,
      unitOfMeasure: resolvePackageUnitOfMeasure({
        persistedUnitOfMeasure: row.unitOfMeasure,
        raw,
      }),
      lastSyncedAt: row.lastSyncedAt.toISOString(),
      selectionReason: "",
      excludedPackageLabels: [],
      skippedPackages: [],
      raw,
    },
    skipped: null,
  };
}

/**
 * Pick a package suitable for METRC transfers (quantity > 0, active, same facility).
 * Never selects packages used by evaluation adjust/finish/unfinish.
 */
export async function resolveTransferableMetrcPackage(input: {
  companyId: string;
  licenseNumber: string;
  excludedPackageLabels?: string[];
}): Promise<TransferablePackageSelection | null> {
  const licenseNumber = String(input.licenseNumber || "").trim();
  if (!licenseNumber) return null;

  const excludedLabels = new Set(
    (input.excludedPackageLabels?.length
      ? input.excludedPackageLabels
      : await listEvaluationMutationPackageLabels(input.companyId)
    ).map((label) => String(label || "").trim()).filter(Boolean),
  );

  const rows = await listMetrcPackagesForCompany(input.companyId);
  const sorted = [...rows].sort(
    (a, b) => b.lastSyncedAt.getTime() - a.lastSyncedAt.getTime(),
  );

  const skippedPackages: SkippedTransferablePackage[] = [];
  const transferable: TransferablePackageSelection[] = [];

  for (const row of sorted) {
    const evaluated = evaluatePackageRow(row, licenseNumber, excludedLabels);
    if (evaluated.skipped) skippedPackages.push(evaluated.skipped);
    if (evaluated.transferable) transferable.push(evaluated.transferable);
  }

  const best = transferable[0];
  if (!best) return null;

  return {
    ...best,
    selectionReason: "most_recent_nonzero_active_package",
    excludedPackageLabels: [...excludedLabels].sort(),
    skippedPackages,
  };
}

export async function refreshTransferablePackageSelection(input: {
  client: MetrcClient;
  licenseNumber: string;
  selection: TransferablePackageSelection;
}): Promise<TransferablePackageSelection> {
  const refreshed = await refreshEvaluationPackageFromMetrc({
    client: input.client,
    licenseNumber: input.licenseNumber,
    pkg: {
      packageLabel: input.selection.packageLabel,
      packageId: input.selection.packageId,
      licenseNumber: input.selection.licenseNumber,
      itemName: "",
      quantity: input.selection.quantity,
      unitOfMeasure: input.selection.unitOfMeasure,
      isFinished: isPackageFinished({ raw: input.selection.raw }),
      raw: input.selection.raw,
      source: "synced_label",
    },
  });

  return {
    ...input.selection,
    quantity: refreshed.quantity,
    unitOfMeasure: refreshed.unitOfMeasure,
    raw: refreshed.raw,
  };
}

export function buildTransferPackageSelectionMeta(
  selection: TransferablePackageSelection | null,
  sourceLicense: string,
): Record<string, unknown> {
  if (!selection) {
    return {
      selectedPackageLabel: null,
      selectedPackageId: null,
      selectedPackageQuantity: null,
      selectedPackageUnit: null,
      selectedPackageLicense: sourceLicense,
      selectedPackageLastModified: null,
      packageSelectionReason: "none_found",
      excludedPackageLabels: [],
      skippedPackages: [],
    };
  }

  return {
    selectedPackageLabel: selection.packageLabel,
    selectedPackageId: selection.packageId,
    selectedPackageQuantity: selection.quantity,
    selectedPackageUnit: selection.unitOfMeasure,
    selectedPackageLicense: selection.licenseNumber,
    selectedPackageLastModified: selection.lastSyncedAt,
    packageSelectionReason: selection.selectionReason,
    excludedPackageLabels: selection.excludedPackageLabels,
    skippedPackages: selection.skippedPackages,
  };
}
