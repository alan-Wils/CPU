/**
 * Pure merge: patch strain auto-metric fields from batch rollups; leaves other strains and top-level cultivation keys intact.
 * When numeric averages exist, also updates `potency` and `averageYield` to match Admin config dropdown values.
 */

import { potencyCategoryFromAvgThcPct, yieldCategoryFromAvgGPerSqFt } from "./strainMetricCategoryMaps.js";

export type StrainMetricBucket = { potencies: number[]; yields: number[] };

function meanFinite(values: number[]): number | null {
    const xs = values.filter((x) => typeof x === "number" && Number.isFinite(x));
    if (xs.length === 0)
        return null;
    return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * @param cultivation — shallow-cloned `CompanyConfig` value for key `cultivation` (must be object, not array).
 * @param byAcronym — uppercase acronyms → sample buckets
 * @param nowIso — stamp for `autoMetricsUpdatedAt`
 */
export function mergeStrainAutoMetricsIntoCultivation(
    cultivation: Record<string, unknown>,
    byAcronym: Map<string, StrainMetricBucket>,
    nowIso: string,
): Record<string, unknown> {
    const out: Record<string, unknown> = { ...cultivation };
    const strainsRaw = out.strains;
    const strains = Array.isArray(strainsRaw) ? [...strainsRaw] : [];
    for (let i = 0; i < strains.length; i++) {
        const s = strains[i];
        if (!s || typeof s !== "object")
            continue;
        const strain = { ...(s as Record<string, unknown>) };
        const acronym = String(strain.acronym || "").trim().toUpperCase();
        if (!acronym)
            continue;
        const bucket = byAcronym.get(acronym);
        if (!bucket)
            continue;
        const avgP = meanFinite(bucket.potencies);
        const avgY = meanFinite(bucket.yields);
        const nP = bucket.potencies.length;
        const nY = bucket.yields.length;
        if (avgP != null) {
            strain.autoAvgPotencyPct = +avgP.toFixed(4);
            strain.potency = potencyCategoryFromAvgThcPct(avgP);
        }
        if (avgY != null) {
            strain.autoAvgDryYieldGPerSqFt = +avgY.toFixed(4);
            strain.averageYield = yieldCategoryFromAvgGPerSqFt(avgY);
        }
        strain.autoMetricsSampleCount = Math.max(nP, nY);
        strain.autoMetricsUpdatedAt = nowIso;
        strains[i] = strain;
    }
    out.strains = strains;
    return out;
}
