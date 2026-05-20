import type { CultivationExtractionTransferRow } from "@/lib/cultivationTransferApi";
import type { CultivationStorageLocation } from "@/lib/cultivationStorageConfig";
import { GRAMS_PER_LB } from "@/lib/freshFrozenPackageDisplay";

export const UNASSIGNED_STORAGE_GROUP_ID = "__unassigned__";

export type CultivationTransferStorageGroup = {
  id: string;
  name: string;
  rows: CultivationExtractionTransferRow[];
};

export type TransferStorageGroupSummary = {
  strains: string[];
  bundleCount: number;
  grams: number;
  lbs: number;
};

/** Strain label from package display name (strips Fresh Frozen / FF · tag suffixes). */
export function strainLabelFromTransferRow(row: CultivationExtractionTransferRow): string {
  const name = String(row.displayName || "").trim();
  if (!name) return String(row.sourceCultivationBatchId || "").trim() || "Unknown";
  const withoutTag = name.replace(/\s+FF\s*·.*$/i, "").trim();
  const strain = withoutTag.replace(/\s+Fresh\s+Frozen\s*$/i, "").trim();
  return strain || withoutTag || name;
}

export function summarizeTransferStorageGroup(
  rows: CultivationExtractionTransferRow[],
): TransferStorageGroupSummary {
  const strainSet = new Set<string>();
  let bundleCount = 0;
  let grams = 0;
  let lbs = 0;

  for (const row of rows) {
    const label = strainLabelFromTransferRow(row);
    if (label) strainSet.add(label);

    bundleCount += Math.max(1, Math.floor(Number(row.bundles) || 0));

    if (row.materialType === "FRESH_FROZEN") {
      const g = Math.max(0, Number(row.grams ?? 0));
      grams += g;
      lbs += row.weightLbs != null && Number.isFinite(Number(row.weightLbs))
        ? Number(row.weightLbs)
        : g / GRAMS_PER_LB;
    } else {
      const w = Math.max(0, Number(row.weightLbs ?? 0));
      lbs += w;
      grams += w * GRAMS_PER_LB;
    }
  }

  return {
    strains: [...strainSet].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    bundleCount,
    grams: Math.round(grams * 100) / 100,
    lbs: Math.round(lbs * 100) / 100,
  };
}

const MAX_STRAINS_ON_CARD = 4;

/** One-line summary for collapsed freezer / dry room header. */
export function formatTransferStorageGroupSummary(
  summary: TransferStorageGroupSummary,
): string {
  const strainPart =
    summary.strains.length === 0
      ? "—"
      : summary.strains.length <= MAX_STRAINS_ON_CARD
        ? summary.strains.join(", ")
        : `${summary.strains.slice(0, MAX_STRAINS_ON_CARD).join(", ")} +${summary.strains.length - MAX_STRAINS_ON_CARD} more`;

  const bundlePart =
    summary.bundleCount === 1 ? "1 bundle" : `${summary.bundleCount.toLocaleString()} bundles`;

  return `${strainPart} · ${bundlePart} · ${summary.grams.toLocaleString()} g · ${summary.lbs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} lbs`;
}

export function storageZoneKey(
  materialType: CultivationExtractionTransferRow["materialType"],
  storageId: string,
): string {
  return `${materialType}:${storageId}`;
}

/** Group transfer rows by assigned freezer / dry room (config order, unassigned last). */
export function groupTransfersByStorage(
  sectionRows: CultivationExtractionTransferRow[],
  locations: CultivationStorageLocation[],
  storageEdits: Record<string, string>,
): CultivationTransferStorageGroup[] {
  const buckets = new Map<string, CultivationExtractionTransferRow[]>();
  const labels = new Map<string, string>();

  for (const row of sectionRows) {
    const locId = storageEdits[row.id] ?? row.storageLocationId ?? "";
    const key = locId || UNASSIGNED_STORAGE_GROUP_ID;
    const loc = locations.find((l) => l.id === locId);
    const label =
      key === UNASSIGNED_STORAGE_GROUP_ID
        ? "Not assigned"
        : (loc?.name ?? String(row.storageLocationName || "").trim()) || "Unknown storage";
    labels.set(key, label);
    const list = buckets.get(key) ?? [];
    list.push(row);
    buckets.set(key, list);
  }

  const groups: CultivationTransferStorageGroup[] = [];
  const seen = new Set<string>();

  for (const loc of locations) {
    const rows = buckets.get(loc.id);
    if (!rows?.length) continue;
    seen.add(loc.id);
    groups.push({ id: loc.id, name: loc.name, rows });
  }

  for (const [id, rows] of buckets) {
    if (id === UNASSIGNED_STORAGE_GROUP_ID || seen.has(id) || rows.length === 0) continue;
    groups.push({ id, name: labels.get(id) ?? id, rows });
  }

  const unassigned = buckets.get(UNASSIGNED_STORAGE_GROUP_ID);
  if (unassigned?.length) {
    groups.push({
      id: UNASSIGNED_STORAGE_GROUP_ID,
      name: labels.get(UNASSIGNED_STORAGE_GROUP_ID) ?? "Not assigned",
      rows: unassigned,
    });
  }

  return groups;
}
