/**
 * Maps numeric rollups to the same categorical labels used in Admin → Company Config
 * (`potency`: Low/Medium/High/Very High; `averageYield`: Light/Medium/Heavy).
 *
 * Thresholds are defaults for v1; tune if your facility norms differ.
 */

/** THC% (lab average) → config potency dropdown. */
export function potencyCategoryFromAvgThcPct(pct: number): string {
    if (!Number.isFinite(pct) || pct < 0)
        return "Low";
    if (pct < 16)
        return "Low";
    if (pct < 22)
        return "Medium";
    if (pct < 28)
        return "High";
    return "Very High";
}

/** Dry flower g/sq ft (allocated canopy) → config averageYield dropdown. */
export function yieldCategoryFromAvgGPerSqFt(gPerSqFt: number): string {
    if (!Number.isFinite(gPerSqFt) || gPerSqFt < 0)
        return "Light";
    if (gPerSqFt < 18)
        return "Light";
    if (gPerSqFt < 42)
        return "Medium";
    return "Heavy";
}
