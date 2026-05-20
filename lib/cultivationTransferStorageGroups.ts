import type { CultivationExtractionTransferRow } from "@/lib/cultivationTransferApi";
import type { CultivationStorageLocation } from "@/lib/cultivationStorageConfig";

export const UNASSIGNED_STORAGE_GROUP_ID = "__unassigned__";

export type CultivationTransferStorageGroup = {
  id: string;
  name: string;
  rows: CultivationExtractionTransferRow[];
};

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
