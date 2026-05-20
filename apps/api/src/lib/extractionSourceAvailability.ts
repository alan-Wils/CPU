/** Keep in sync with repo root `lib/extractionSourceAvailability.ts`. */

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
    grams?: number;
    weightLbs?: number;
    amount?: string;
    cultivationTransferId?: string;
    manualTransferToExtraction?: boolean;
};

function norm(value: unknown): string {
    return String(value ?? "").trim();
}

function num(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function getSourceOriginalLbs(source: SourceBatchLike): number {
    if (source.weightLbs !== undefined && source.weightLbs !== null)
        return num(source.weightLbs);
    if (source.grams !== undefined && source.grams !== null)
        return num(source.grams) / 453.592;
    const text = String(source.amount ?? "").toLowerCase();
    const gramsMatch = text.match(/(\d+(\.\d+)?)\s*grams?/);
    if (gramsMatch)
        return num(gramsMatch[1]) / 453.592;
    const lbsMatch = text.match(/(\d+(\.\d+)?)\s*lbs?/);
    if (lbsMatch)
        return num(lbsMatch[1]);
    return 0;
}

export function isFreshFrozenSourceRow(row: SourceBatchLike): boolean {
    const t = norm(row.type || row.name).toLowerCase();
    return t.includes("fresh frozen") || t.includes("fresh-frozen");
}

export function isEmptyPrismaSourcePlaceholder(row: SourceBatchLike): boolean {
    const id = norm(row.id);
    if (!/^c[a-z0-9]{20,}$/i.test(id))
        return false;
    if (getSourceOriginalLbs(row) > 0)
        return false;
    if (norm(row.amount))
        return false;
    return true;
}

export function isPerBundleTransferSource(row: SourceBatchLike): boolean {
    if (row.manualTransferToExtraction === true)
        return true;
    if (norm(row.cultivationTransferId))
        return true;
    const tag = norm(row.metrcTag || row.plantTag);
    if (tag) {
        const bundles = Math.floor(Number(row.bundles) || 0);
        if (bundles <= 1)
            return true;
        const harvestCode = norm(row.harvestCode);
        return harvestCode.includes(tag.replace(/\s+/g, ""));
    }
    if (isFreshFrozenSourceRow(row)) {
        const bundles = Math.floor(Number(row.bundles) || 0);
        const grams = Number(row.grams) || 0;
        if (bundles === 1 && grams > 0)
            return true;
    }
    return false;
}

export function isLegacyMonolithicFreshFrozenSource(row: SourceBatchLike): boolean {
    if (!isFreshFrozenSourceRow(row))
        return false;
    if (isPerBundleTransferSource(row))
        return false;
    const source = norm(row.source);
    const id = norm(row.id);
    if (!source)
        return false;
    if (id === source)
        return true;
    const harvestCode = norm(row.harvestCode);
    if (!harvestCode || harvestCode === id || harvestCode === source)
        return true;
    return false;
}

export function filterSourceBatchesForExtractionAvailability<T extends SourceBatchLike>(rows: T[]): T[] {
    if (!rows.length)
        return rows;
    const usable = rows.filter((row) => !isEmptyPrismaSourcePlaceholder(row));
    if (!usable.length)
        return usable;
    const sourcesWithBundles = new Set<string>();
    const parentGroupsWithBundles = new Set<string>();
    for (const row of usable) {
        if (!isPerBundleTransferSource(row))
            continue;
        const source = norm(row.source);
        if (source)
            sourcesWithBundles.add(source);
        const parent = norm(row.parentGroupId);
        if (parent)
            parentGroupsWithBundles.add(parent);
    }
    if (sourcesWithBundles.size === 0 && parentGroupsWithBundles.size === 0)
        return usable;
    return usable.filter((row) => {
        if (!isLegacyMonolithicFreshFrozenSource(row))
            return true;
        const source = norm(row.source);
        if (source && sourcesWithBundles.has(source))
            return false;
        const parent = norm(row.parentGroupId);
        if (parent && parentGroupsWithBundles.has(parent))
            return false;
        return true;
    });
}

export function prioritizeTransferredSourceStoreRows(rows: unknown[]): unknown[] {
    const transfers: unknown[] = [];
    const rest: unknown[] = [];
    for (const raw of rows) {
        const row = raw && typeof raw === "object" ? (raw as SourceBatchLike) : null;
        if (!row)
            continue;
        if (row.manualTransferToExtraction === true || norm(row.cultivationTransferId))
            transfers.push(raw);
        else
            rest.push(raw);
    }
    return [...transfers, ...rest];
}

export function pruneLegacyMonolithicFreshFrozenFromStore(
    list: unknown[],
    affectedCultivationBatchIds: Set<string>,
    affectedParentGroupIds: Set<string>,
): unknown[] {
    if (!affectedCultivationBatchIds.size && !affectedParentGroupIds.size)
        return list;
    return list.filter((raw) => {
        const row = raw && typeof raw === "object" ? (raw as SourceBatchLike) : null;
        if (!row || !isLegacyMonolithicFreshFrozenSource(row))
            return true;
        const source = norm(row.source);
        if (source && affectedCultivationBatchIds.has(source))
            return false;
        const parent = norm(row.parentGroupId);
        if (parent && affectedParentGroupIds.has(parent))
            return false;
        return true;
    });
}
