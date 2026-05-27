import {
  METRC_EVALUATION_ADJUST_QUANTITY,
  METRC_EVALUATION_DEFAULT_PACKAGE_LABEL,
  METRC_EVALUATION_DEFAULT_PACKAGE_LICENSE,
  METRC_EVALUATION_DEFAULT_PACKAGE_UNIT,
} from "./metrcPackageEvaluationDefaults.js";
import {
  listEvaluationCreatedPackageRefs,
  type EvaluationCreatedPackageRef,
} from "./metrcEvaluationCreatedPackages.js";
import {
  isPackageFinished,
  isPackageOnHold,
  isPackageQuantityEmpty,
  isPackageTransferable,
  PACKAGE_QUANTITY_EMPTY_EPSILON,
} from "./metrcPackageStatus.js";
import { listMetrcPackagesForCompany } from "../repositories/metrcPackageRepository.js";

export { isPackageQuantityEmpty, PACKAGE_QUANTITY_EMPTY_EPSILON } from "./metrcPackageStatus.js";

export type MetrcEvaluationPackageResolveKind =
  | "change_item"
  | "adjust"
  | "finish"
  | "unfinish"
  | "transfer"
  | "default";

export type ResolvedMetrcEvaluationPackage = {
  packageLabel: string;
  packageId: string | null;
  licenseNumber: string;
  itemName: string;
  quantity: number;
  unitOfMeasure: string;
  isFinished: boolean;
  raw: Record<string, unknown>;
  source:
    | "evaluation_created"
    | "from_package_finish_result"
    | "transferable_fallback"
    | "synced_label"
    | "synced_recent";
  selectedReason: string;
  createdViaTest: boolean;
  createdAt: string | null;
};

export class MetrcEvaluationPackageNotFoundError extends Error {
  constructor(
    message = "No usable evaluation package found. Run Create Package first.",
  ) {
    super(message);
    this.name = "MetrcEvaluationPackageNotFoundError";
  }
}

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

function readNumberField(row: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const raw = row[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const n = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

const PACKAGE_QUANTITY_FIELD_KEYS = [
  "Quantity",
  "quantity",
  "RemainingQuantity",
  "remainingQuantity",
] as const;

export function resolvePackageQuantity(input: {
  persistedQuantity?: number | null;
  raw?: Record<string, unknown> | null;
}): number {
  if (input.raw && typeof input.raw === "object") {
    for (const key of PACKAGE_QUANTITY_FIELD_KEYS) {
      if (!(key in input.raw)) continue;
      const raw = input.raw[key];
      if (raw === undefined || raw === null || raw === "") continue;
      const n = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (Number.isFinite(n)) return n;
    }
  }
  const persisted = Number(input.persistedQuantity);
  return Number.isFinite(persisted) ? persisted : 0;
}

/** Prefer DB-synced quantity over stale raw METRC payload (e.g. after evaluation adjust to zero). */
export function resolveSyncedPackageQuantity(input: {
  persistedQuantity?: number | null;
  raw?: Record<string, unknown> | null;
}): number {
  const persisted = Number(input.persistedQuantity);
  if (Number.isFinite(persisted)) return persisted;
  return resolvePackageQuantity(input);
}

/** METRC adjust Quantity is a delta — negative current quantity zeroes the package for finish. */
export function resolveEvaluationAdjustQuantity(pkg: {
  quantity: number;
  raw: Record<string, unknown>;
}): number {
  const current = resolvePackageQuantity({
    persistedQuantity: pkg.quantity,
    raw: pkg.raw,
  });
  if (current > PACKAGE_QUANTITY_EMPTY_EPSILON) return -current;
  return METRC_EVALUATION_ADJUST_QUANTITY;
}

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

function isStaleEvaluationDefaultLabel(label: string | null | undefined): boolean {
  const normalized = String(label || "").trim();
  return !normalized || normalized === METRC_EVALUATION_DEFAULT_PACKAGE_LABEL;
}

function matchesLicense(rowLicense: string, licenseNumber: string | null | undefined): boolean {
  const license = String(licenseNumber || "").trim();
  if (!license) return true;
  return rowLicense.trim().toLowerCase() === license.toLowerCase();
}

type PackageCandidate = {
  row: Awaited<ReturnType<typeof listMetrcPackagesForCompany>>[number];
  raw: Record<string, unknown>;
  quantity: number;
  isFinished: boolean;
  isOnHold: boolean;
  createdRef: EvaluationCreatedPackageRef | null;
};

function buildCandidate(
  row: Awaited<ReturnType<typeof listMetrcPackagesForCompany>>[number],
  createdRef: EvaluationCreatedPackageRef | null,
): PackageCandidate {
  const raw = (() => {
    try {
      return JSON.parse(row.rawPayloadJson || "{}") as Record<string, unknown>;
    } catch {
      return {};
    }
  })();

  return {
    row,
    raw,
    quantity: resolveSyncedPackageQuantity({ persistedQuantity: row.quantity, raw }),
    isFinished: isPackageFinished({ raw }),
    isOnHold: isPackageOnHold({ raw }),
    createdRef,
  };
}

function matchesKindCriteria(candidate: PackageCandidate, kind: MetrcEvaluationPackageResolveKind): boolean {
  if (candidate.isOnHold) return false;

  if (kind === "finish") {
    return !candidate.isFinished && isPackageQuantityEmpty(candidate.quantity);
  }

  if (kind === "unfinish") {
    return candidate.isFinished;
  }

  if (kind === "transfer") {
    return isPackageTransferable({
      quantity: candidate.quantity,
      isFinished: candidate.isFinished,
      isOnHold: candidate.isOnHold,
      raw: candidate.raw,
    });
  }

  if (candidate.isFinished) return false;
  return candidate.quantity > PACKAGE_QUANTITY_EMPTY_EPSILON;
}

function candidateToResolved(
  candidate: PackageCandidate,
  input: {
    licenseNumber?: string | null;
    source: ResolvedMetrcEvaluationPackage["source"];
    selectedReason: string;
    createdViaTest: boolean;
    createdAt: string | null;
    explicitPackageId?: string | null;
    isFinishedOverride?: boolean;
  },
): ResolvedMetrcEvaluationPackage {
  const isFinished = input.isFinishedOverride ?? candidate.isFinished;
  return {
    packageLabel: candidate.row.packageLabel,
    packageId: input.explicitPackageId ?? readPackageIdFromRaw(candidate.row.rawPayloadJson),
    licenseNumber:
      String(input.licenseNumber || "").trim() ||
      candidate.row.licenseNumber.trim() ||
      METRC_EVALUATION_DEFAULT_PACKAGE_LICENSE,
    itemName: candidate.row.itemName.trim(),
    quantity: candidate.quantity,
    unitOfMeasure: resolvePackageUnitOfMeasure({
      persistedUnitOfMeasure: candidate.row.unitOfMeasure,
      raw: candidate.raw,
    }),
    isFinished,
    raw: isFinished ? { ...candidate.raw, IsFinished: true } : candidate.raw,
    source: input.source,
    selectedReason: input.selectedReason,
    createdViaTest: input.createdViaTest,
    createdAt: input.createdAt,
  };
}

export async function resolveMetrcEvaluationPackage(input: {
  companyId: string;
  packageLabel?: string | null;
  packageId?: string | null;
  licenseNumber?: string | null;
  kind?: MetrcEvaluationPackageResolveKind;
}): Promise<ResolvedMetrcEvaluationPackage> {
  const kind = input.kind ?? "default";
  if (kind === "unfinish") {
    throw new Error(
      "resolveMetrcEvaluationPackage does not support kind=unfinish; use resolveUnfinishPackageForEvaluation.",
    );
  }

  const explicitLabel = isStaleEvaluationDefaultLabel(input.packageLabel)
    ? ""
    : String(input.packageLabel || "").trim();
  const explicitId = String(input.packageId || "").trim();
  const licenseNumber = String(input.licenseNumber || "").trim();

  const rows = await listMetrcPackagesForCompany(input.companyId);
  const createdRefs = await listEvaluationCreatedPackageRefs(input.companyId);
  const createdByLabel = new Map(createdRefs.map((ref) => [ref.packageLabel, ref]));

  const candidates = rows
    .filter((row) => matchesLicense(row.licenseNumber, licenseNumber))
    .map((row) => buildCandidate(row, createdByLabel.get(row.packageLabel) ?? null));

  if (explicitLabel) {
    const match = candidates.find((candidate) => candidate.row.packageLabel === explicitLabel);
    if (match && matchesKindCriteria(match, kind)) {
      return candidateToResolved(match, {
        licenseNumber,
        source: "synced_label",
        selectedReason: "explicit_package_label",
        createdViaTest: Boolean(match.createdRef),
        createdAt: match.createdRef?.createdAt.toISOString() ?? null,
        explicitPackageId: explicitId || undefined,
      });
    }
  }

  if (explicitId) {
    const match = candidates.find(
      (candidate) => readPackageIdFromRaw(candidate.row.rawPayloadJson) === explicitId,
    );
    if (match && matchesKindCriteria(match, kind)) {
      return candidateToResolved(match, {
        licenseNumber,
        source: "synced_label",
        selectedReason: "explicit_package_id",
        createdViaTest: Boolean(match.createdRef),
        createdAt: match.createdRef?.createdAt.toISOString() ?? null,
        explicitPackageId: explicitId,
      });
    }
  }

  const evaluationCreated = candidates
    .filter((candidate) => candidate.createdRef)
    .sort(
      (a, b) =>
        (b.createdRef?.createdAt.getTime() ?? 0) - (a.createdRef?.createdAt.getTime() ?? 0),
    );

  for (const candidate of evaluationCreated) {
    if (!matchesKindCriteria(candidate, kind)) continue;
    return candidateToResolved(candidate, {
      licenseNumber,
      source: "evaluation_created",
      selectedReason: "newest_evaluation_created_package",
      createdViaTest: true,
      createdAt: candidate.createdRef?.createdAt.toISOString() ?? null,
    });
  }

  const transferableFallback = [...candidates]
    .filter((candidate) => matchesKindCriteria(candidate, kind))
    .sort((a, b) => b.row.lastSyncedAt.getTime() - a.row.lastSyncedAt.getTime());

  const fallback = transferableFallback[0];
  if (fallback) {
    return candidateToResolved(fallback, {
      licenseNumber,
      source: "transferable_fallback",
      selectedReason:
        kind === "transfer"
          ? "newest_transferable_synced_package"
          : "newest_usable_synced_package",
      createdViaTest: Boolean(fallback.createdRef),
      createdAt: fallback.createdRef?.createdAt.toISOString() ?? null,
    });
  }

  throw new MetrcEvaluationPackageNotFoundError();
}

export function buildEvaluationPackageSelectionDiagnostics(
  pkg: ResolvedMetrcEvaluationPackage,
): Record<string, unknown> {
  return {
    selectedPackageLabel: pkg.packageLabel,
    selectedReason: pkg.selectedReason,
    selectedPackageQuantity: pkg.quantity,
    selectedPackageUnit: pkg.unitOfMeasure,
    selectedPackageLicense: pkg.licenseNumber,
    selectedPackageFinished: pkg.isFinished,
    createdViaTest: pkg.createdViaTest,
    selectedPackageCreatedAt: pkg.createdAt,
    packageSource: pkg.source,
  };
}
