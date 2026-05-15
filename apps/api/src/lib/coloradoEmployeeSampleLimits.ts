/**
 * Colorado MED employee R&D sample monthly caps (per designated sampling employee, per calendar month).
 * Effective Jan. 5, 2026 — see HB25-1209 / 1 CCR 212-3 Rule 5-320 family rules; adjust here when MED updates.
 *
 * Flower: MED does not publish the same explicit gram cap as concentrate/servings; use a company-configurable
 * monthly flower gram limit (see `resolveFlowerGramMonthlyLimit`).
 */

export const COLORADO_EMPLOYEE_SAMPLE_MEDICAL_CONCENTRATE_GRAMS_PER_MONTH = 15;
export const COLORADO_EMPLOYEE_SAMPLE_RETAIL_CONCENTRATE_GRAMS_PER_MONTH = 8;
/** Medical or retail: servings / products (non-flower buckets) share this cap. */
export const COLORADO_EMPLOYEE_SAMPLE_SERVINGS_OR_PRODUCTS_PER_MONTH = 14;

/** Default monthly flower (inhalable plant material) grams when company has not configured `employeeSamples.flowerGramsMonthlyLimit`. */
export const DEFAULT_FLOWER_GRAMS_MONTHLY_LIMIT = 28;

export type EmployeeSamplesCompanyConfigShape = {
    flowerGramsMonthlyLimit?: number | null;
};

export function parseEmployeeSamplesConfigJson(raw: string | null | undefined): EmployeeSamplesCompanyConfigShape {
    if (!raw || !String(raw).trim())
        return {};
    try {
        const v = JSON.parse(String(raw)) as unknown;
        if (!v || typeof v !== "object" || Array.isArray(v))
            return {};
        const o = v as Record<string, unknown>;
        const lim = o.flowerGramsMonthlyLimit;
        if (lim == null)
            return {};
        if (typeof lim !== "number" || !Number.isFinite(lim) || lim < 0)
            return {};
        return { flowerGramsMonthlyLimit: lim };
    } catch {
        return {};
    }
}

export function resolveFlowerGramMonthlyLimit(config: EmployeeSamplesCompanyConfigShape): number {
    const v = config.flowerGramsMonthlyLimit;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0)
        return v;
    return DEFAULT_FLOWER_GRAMS_MONTHLY_LIMIT;
}
