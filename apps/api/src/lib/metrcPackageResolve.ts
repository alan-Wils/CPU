import {
  METRC_EVALUATION_DEFAULT_PACKAGE_ID,
  METRC_EVALUATION_DEFAULT_PACKAGE_LABEL,
  METRC_EVALUATION_DEFAULT_PACKAGE_LICENSE,
  METRC_EVALUATION_DEFAULT_PACKAGE_UNIT,
} from "./metrcPackageEvaluationDefaults.js";
import { listMetrcPackagesForCompany } from "../repositories/metrcPackageRepository.js";

function readStringField(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const raw = row[key];
    if (raw === undefined || raw === null) continue;
    const s = String(raw).trim();
    if (s) return s;
  }
  return "";
}

const PACKAGE_UNIT_FIELD_KEYS = [
  "UnitOfWeight",
  "unitOfWeight",
  "UnitOfWeightName",
  "unitOfWeightName",
  "UnitOfMeasureName",
  "unitOfMeasureName",
  "UnitOfMeasure",
  "unitOfMeasure",
] as const;

/** Unit of measure for METRC package mutations — raw METRC UnitOfWeight first, then synced row. */
export function resolvePackageUnitOfMeasure(input: {
  persistedUnitOfMeasure?: string | null;
  raw?: Record<string, unknown> | null;
}): string {
  if (input.raw && typeof input.raw === "object") {
    const fromRaw = readStringField(input.raw, [...PACKAGE_UNIT_FIELD_KEYS]);
    if (fromRaw) return fromRaw;
  }
  return String(input.persistedUnitOfMeasure || "").trim();
}

export type ResolvedMetrcEvaluationPackage = {
  packageLabel: string;
  packageId: string | null;
  licenseNumber: string;
  itemName: string;
  unitOfMeasure: string;
  raw: Record<string, unknown>;
  source: "synced_recent" | "synced_label" | "fallback";
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

function rowToResolved(
  row: Awaited<ReturnType<typeof listMetrcPackagesForCompany>>[number],
  source: ResolvedMetrcEvaluationPackage["source"],
): ResolvedMetrcEvaluationPackage {
  const raw = (() => {
    try {
      return JSON.parse(row.rawPayloadJson || "{}") as Record<string, unknown>;
    } catch {
      return {};
    }
  })();

  return {
    packageLabel: row.packageLabel,
    packageId: readPackageIdFromRaw(row.rawPayloadJson),
    licenseNumber: row.licenseNumber.trim() || METRC_EVALUATION_DEFAULT_PACKAGE_LICENSE,
    itemName: row.itemName.trim(),
    unitOfMeasure: resolvePackageUnitOfMeasure({
      persistedUnitOfMeasure: row.unitOfMeasure,
      raw,
    }),
    raw,
    source,
  };
}

export async function resolveMetrcEvaluationPackage(input: {
  companyId: string;
  packageLabel?: string | null;
  packageId?: string | null;
  licenseNumber?: string | null;
}): Promise<ResolvedMetrcEvaluationPackage> {
  const explicitLabel = String(input.packageLabel || "").trim();
  const explicitId = String(input.packageId || "").trim();
  const explicitLicense = String(input.licenseNumber || "").trim();

  const rows = await listMetrcPackagesForCompany(input.companyId);
  const sorted = [...rows].sort(
    (a, b) => b.lastSyncedAt.getTime() - a.lastSyncedAt.getTime(),
  );

  if (explicitLabel) {
    const match = sorted.find((row) => row.packageLabel === explicitLabel);
    if (match) {
      const resolved = rowToResolved(match, "synced_label");
      if (explicitLicense) resolved.licenseNumber = explicitLicense;
      if (explicitId) resolved.packageId = explicitId;
      return resolved;
    }
  }

  if (explicitId) {
    const match = sorted.find((row) => readPackageIdFromRaw(row.rawPayloadJson) === explicitId);
    if (match) {
      const resolved = rowToResolved(match, "synced_label");
      if (explicitLicense) resolved.licenseNumber = explicitLicense;
      return resolved;
    }
  }

  if (sorted[0]) {
    const resolved = rowToResolved(sorted[0], "synced_recent");
    if (explicitLicense) resolved.licenseNumber = explicitLicense;
    if (explicitId) resolved.packageId = explicitId;
    if (explicitLabel) resolved.packageLabel = explicitLabel;
    return resolved;
  }

  return {
    packageLabel: explicitLabel || METRC_EVALUATION_DEFAULT_PACKAGE_LABEL,
    packageId: explicitId || METRC_EVALUATION_DEFAULT_PACKAGE_ID,
    licenseNumber: explicitLicense || METRC_EVALUATION_DEFAULT_PACKAGE_LICENSE,
    itemName: "",
    unitOfMeasure: METRC_EVALUATION_DEFAULT_PACKAGE_UNIT,
    raw: {},
    source: "fallback",
  };
}
