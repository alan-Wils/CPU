import {
  isPackageFinished,
  isPackageOnHold,
  isPackageQuantityEmpty,
  isPackageTransferable,
} from "./metrcPackageStatus.js";
import {
  resolvePackageQuantity,
  resolvePackageUnitOfMeasure,
} from "./metrcPackageResolve.js";
import { listMetrcPackagesForCompany } from "../repositories/metrcPackageRepository.js";

export type TransferablePackageSkipReason =
  | "license_mismatch"
  | "zero_quantity"
  | "finished"
  | "on_hold";

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
  selectionReason: string;
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
): { transferable: TransferablePackageSelection | null; skipped: SkippedTransferablePackage | null } {
  const raw = (() => {
    try {
      return JSON.parse(row.rawPayloadJson || "{}") as Record<string, unknown>;
    } catch {
      return {};
    }
  })();

  const quantity = resolvePackageQuantity({ persistedQuantity: row.quantity, raw });
  const license = row.licenseNumber.trim();
  const label = row.packageLabel;

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
      selectionReason: "",
      skippedPackages: [],
      raw,
    },
    skipped: null,
  };
}

/**
 * Pick a package suitable for METRC transfers (quantity > 0, active, same facility).
 * Skips evaluation mutation package when it has been zeroed out.
 */
export async function resolveTransferableMetrcPackage(input: {
  companyId: string;
  licenseNumber: string;
  preferredPackageLabel?: string | null;
}): Promise<TransferablePackageSelection | null> {
  const licenseNumber = String(input.licenseNumber || "").trim();
  if (!licenseNumber) return null;

  const preferred = String(input.preferredPackageLabel || "").trim();
  const rows = await listMetrcPackagesForCompany(input.companyId);
  const sorted = [...rows].sort(
    (a, b) => b.lastSyncedAt.getTime() - a.lastSyncedAt.getTime(),
  );

  const skippedPackages: SkippedTransferablePackage[] = [];
  const transferable: TransferablePackageSelection[] = [];

  for (const row of sorted) {
    const evaluated = evaluatePackageRow(row, licenseNumber);
    if (evaluated.skipped) skippedPackages.push(evaluated.skipped);
    if (evaluated.transferable) transferable.push(evaluated.transferable);
  }

  if (preferred) {
    const preferredMatch = transferable.find((row) => row.packageLabel === preferred);
    if (preferredMatch) {
      return {
        ...preferredMatch,
        selectionReason: "preferred_label_transferable",
        skippedPackages,
      };
    }
  }

  const best = transferable[0];
  if (!best) return null;

  return {
    ...best,
    selectionReason: preferred
      ? "most_recent_transferable_after_skipping_preferred"
      : "most_recent_synced_transferable",
    skippedPackages,
  };
}
