import { GRAMS_PER_LB, sourceRowBundles, sourceRowTotalLbs } from "@/lib/freshFrozenPackageDisplay";

export type SourceBatchLike = Record<string, unknown> & {
  id?: string;
  harvestCode?: string;
  source?: string;
  parentGroupId?: string;
  harvestDate?: string;
  type?: string;
  name?: string;
};

export type ExtractionHarvestSourceGroup = {
  key: string;
  label: string;
  harvestBatchId: string;
  rows: SourceBatchLike[];
  packageCount: number;
  totalGrams: number;
  totalLbs: number;
  totalBundles: number;
  hasFreshFrozen: boolean;
};

/** Stable group key: same harvest event / cultivation harvest batch. */
export function harvestGroupKeyForSourceBatch(row: SourceBatchLike): string {
  const parentGroupId = String(row.parentGroupId ?? "").trim();
  if (parentGroupId) return `parent:${parentGroupId}`;
  const source = String(row.source ?? "").trim();
  const harvestDate = String(row.harvestDate ?? "").trim();
  if (source && harvestDate) return `harvest:${source}|${harvestDate}`;
  if (source) return `source:${source}`;
  const harvestCode = String(row.harvestCode ?? row.id ?? "").trim();
  return harvestCode ? `code:${harvestCode}` : `pkg:${String(row.id ?? "")}`;
}

export function harvestGroupLabelForSourceBatch(row: SourceBatchLike): string {
  const source = String(row.source ?? "").trim();
  if (source) return `Batch ${source}`;
  const harvestCode = String(row.harvestCode ?? row.id ?? "").trim();
  return harvestCode ? `Batch ${harvestCode}` : "Harvest batch";
}

export function harvestGroupZoneKey(group: Pick<ExtractionHarvestSourceGroup, "key">): string {
  return group.key;
}

function isFreshFrozenRow(row: SourceBatchLike): boolean {
  const t = String(row.type ?? row.name ?? "").toLowerCase();
  return t.includes("fresh frozen") || t.includes("fresh-frozen");
}

/** Group available source batches by harvest batch (parentGroupId or cultivation batch + date). */
export function groupSourceBatchesByHarvest(
  rows: SourceBatchLike[],
): ExtractionHarvestSourceGroup[] {
  const buckets = new Map<string, SourceBatchLike[]>();
  const labels = new Map<string, string>();
  const harvestIds = new Map<string, string>();

  for (const row of rows) {
    const key = harvestGroupKeyForSourceBatch(row);
    const list = buckets.get(key) ?? [];
    list.push(row);
    buckets.set(key, list);
    if (!labels.has(key)) labels.set(key, harvestGroupLabelForSourceBatch(row));
    if (!harvestIds.has(key)) {
      harvestIds.set(key, String(row.source ?? row.harvestCode ?? row.id ?? "").trim());
    }
  }

  const groups: ExtractionHarvestSourceGroup[] = [];
  for (const [key, groupRows] of buckets) {
    let totalLbs = 0;
    let totalBundles = 0;
    let hasFreshFrozen = false;
    for (const row of groupRows) {
      const lbs = sourceRowTotalLbs(row);
      totalLbs += lbs;
      if (isFreshFrozenRow(row)) {
        hasFreshFrozen = true;
        totalBundles += sourceRowBundles(row) || 0;
      }
    }
    groups.push({
      key,
      label: labels.get(key) ?? "Harvest batch",
      harvestBatchId: harvestIds.get(key) ?? "",
      rows: groupRows,
      packageCount: groupRows.length,
      totalGrams: Math.round(totalLbs * GRAMS_PER_LB),
      totalLbs: +totalLbs.toFixed(4),
      totalBundles,
      hasFreshFrozen,
    });
  }

  groups.sort((a, b) => {
    const idCmp = a.harvestBatchId.localeCompare(b.harvestBatchId);
    if (idCmp !== 0) return idCmp;
    return a.label.localeCompare(b.label);
  });

  return groups;
}

export function findHarvestGroupForSourceId(
  groups: ExtractionHarvestSourceGroup[],
  sourceId: string,
): ExtractionHarvestSourceGroup | null {
  const id = String(sourceId ?? "").trim();
  if (!id) return null;
  return groups.find((g) => g.rows.some((r) => String(r.id ?? "").trim() === id)) ?? null;
}

export function findHarvestGroupKeyForSourceId(
  groups: ExtractionHarvestSourceGroup[],
  sourceId: string,
): string {
  return findHarvestGroupForSourceId(groups, sourceId)?.key ?? "";
}

/** Dropdown label for harvest batch (cultivation / parent group). */
export function formatHarvestGroupSelectLabel(group: ExtractionHarvestSourceGroup): string {
  const id = group.harvestBatchId || group.label.replace(/^Batch\s+/i, "");
  const material = group.hasFreshFrozen ? "Fresh Frozen" : "Dry Trim";
  const pkg =
    group.packageCount === 1 ? "1 package" : `${group.packageCount} packages`;
  let line = `${id} · ${material} · ${pkg} · ${group.totalLbs.toFixed(2)} lbs`;
  if (group.hasFreshFrozen && group.totalBundles > 0) {
    line += ` · ${group.totalBundles} bundle${group.totalBundles === 1 ? "" : "s"}`;
  }
  return line;
}

export function strainHintFromSourceRow(row: SourceBatchLike): string {
  const name = String(row.name ?? "").trim();
  if (!name) return "";
  const ffIdx = name.indexOf(" FF");
  if (ffIdx > 0) return name.slice(0, ffIdx).trim();
  const trimIdx = name.toLowerCase().indexOf(" trim");
  if (trimIdx > 0) return name.slice(0, trimIdx).trim();
  return name.split("·")[0]?.trim() || name;
}

export function formatHarvestGroupSelectLabelWithStrain(group: ExtractionHarvestSourceGroup): string {
  const strain = strainHintFromSourceRow(group.rows[0] ?? {});
  const base = formatHarvestGroupSelectLabel(group);
  return strain ? `${strain} — ${base}` : base;
}
