/**
 * Extraction should only show material that was explicitly transferred from cultivation
 * (per METRC bundle), not legacy monolithic Fresh Frozen rows tied to the whole harvest.
 */

export type SourceBatchLike = Record<string, unknown> & {
  id?: string;
  source?: string;
  type?: string;
  name?: string;
  harvestCode?: string;
  metrcTag?: string;
  plantTag?: string;
  parentGroupId?: string;
  bundles?: number;
  cultivationTransferId?: string;
  manualTransferToExtraction?: boolean;
};

function norm(value: unknown): string {
  return String(value ?? "").trim();
}

export function isFreshFrozenSourceRow(row: SourceBatchLike): boolean {
  const t = norm(row.type || row.name).toLowerCase();
  return t.includes("fresh frozen") || t.includes("fresh-frozen");
}

/** Row created by cultivation → extraction transfer (per METRC bundle). */
export function isPerBundleTransferSource(row: SourceBatchLike): boolean {
  if (row.manualTransferToExtraction === true) return true;
  if (norm(row.cultivationTransferId)) return true;
  const tag = norm(row.metrcTag || row.plantTag);
  if (!tag) return false;
  const bundles = Math.floor(Number(row.bundles) || 0);
  if (bundles <= 1) return true;
  const harvestCode = norm(row.harvestCode);
  return harvestCode.includes(tag.replace(/\s+/g, ""));
}

/**
 * Legacy store row: whole-harvest Fresh Frozen keyed by cultivation batch id
 * (before per-bundle METRC transfers).
 */
export function isLegacyMonolithicFreshFrozenSource(row: SourceBatchLike): boolean {
  if (!isFreshFrozenSourceRow(row)) return false;
  if (isPerBundleTransferSource(row)) return false;
  const source = norm(row.source);
  const id = norm(row.id);
  if (!source) return false;
  if (id === source) return true;
  const harvestCode = norm(row.harvestCode);
  if (!harvestCode || harvestCode === id || harvestCode === source) return true;
  return false;
}

/**
 * Drop obsolete monolithic FF rows when per-bundle transfer rows exist for the same harvest.
 */
export function filterSourceBatchesForExtractionAvailability<T extends SourceBatchLike>(
  rows: T[],
): T[] {
  if (!rows.length) return rows;

  const sourcesWithBundles = new Set<string>();
  const parentGroupsWithBundles = new Set<string>();

  for (const row of rows) {
    if (!isPerBundleTransferSource(row)) continue;
    const source = norm(row.source);
    if (source) sourcesWithBundles.add(source);
    const parent = norm(row.parentGroupId);
    if (parent) parentGroupsWithBundles.add(parent);
  }

  if (sourcesWithBundles.size === 0 && parentGroupsWithBundles.size === 0) {
    return rows;
  }

  return rows.filter((row) => {
    if (!isLegacyMonolithicFreshFrozenSource(row)) return true;
    const source = norm(row.source);
    if (source && sourcesWithBundles.has(source)) return false;
    const parent = norm(row.parentGroupId);
    if (parent && parentGroupsWithBundles.has(parent)) return false;
    return true;
  });
}
