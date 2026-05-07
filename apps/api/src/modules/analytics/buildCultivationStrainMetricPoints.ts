/** Build analytics points from cultivation rows + company-store dry flower batches. */

export type CultivationStrainMetricPoint = {
    batchId: string;
    strain: string;
    strainAcronym: string;
    date: string;
    potencyPct: number | null;
    dryYieldGPerSqFt: number | null;
    /** Grams per sq ft from Fresh Frozen harvest ÷ parent canopy (dry canopy or FF-allocated table sq ft). */
    freshFrozenYieldGPerSqFt: number | null;
    /** Stem waste from AI sheet sum minus operator-entered FF grams, ÷ canopy (g/sq ft). */
    freshFrozenStemWasteGPerSqFt: number | null;
};

type CultivationRowInput = {
    id: string;
    strain: string;
    strainAcronym: string;
    updatedAt: Date;
    cultivationUiState: unknown;
    /** Relational `CultivationBatch.freshFrozenGrams` — fallback when store FF row omits numeric grams. */
    freshFrozenGrams?: number | null;
};

function asUiRecord(value: unknown): Record<string, unknown> {
    if (value === null || value === undefined)
        return {};
    if (typeof value !== "object" || Array.isArray(value))
        return {};
    return value as Record<string, unknown>;
}

function readNum(ui: Record<string, unknown>, key: string): number | null {
    const v = ui[key];
    if (v == null)
        return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function dryFlowerLabLooksCommitted(dry: Record<string, unknown>): boolean {
    const status = String(dry.status ?? "");
    const testStatus = String(dry.testStatus ?? "");
    return (
        status.includes("Passed")
        || testStatus.toLowerCase().includes("passed")
    );
}

function resolveMetricDate(
    atRaw: unknown,
    fallback: Date,
): Date {
    if (typeof atRaw === "string" && atRaw.trim()) {
        const d = new Date(atRaw);
        if (!Number.isNaN(d.getTime()))
            return d;
    }
    if (typeof atRaw === "number" && Number.isFinite(atRaw)) {
        const d = new Date(atRaw);
        if (!Number.isNaN(d.getTime()))
            return d;
    }
    return fallback;
}

function isFreshFrozenSourceRow(row: Record<string, unknown>): boolean {
    const id = String(row.id ?? "").trim();
    const typ = String(row.type ?? "").trim().toLowerCase();
    if (id.startsWith("FF-"))
        return true;
    return typ.includes("fresh frozen") || typ.includes("freshfrozen");
}

/**
 * Company store mirrors Fresh Frozen into `productionBatches` / moves consumed rows to `completedSourceBatches`.
 * Strain analytics historically consumed only `sourceBatches`, missing FF rows that exist solely in those arrays.
 */
export function mergeFreshFrozenSourcesForAnalytics(
    sourceBatches: unknown[],
    productionBatches: unknown[],
    completedSourceBatches: unknown[],
): unknown[] {
    const primary = Array.isArray(sourceBatches) ? sourceBatches : [];
    const out: unknown[] = [...primary];
    const seen = new Set<string>();
    for (const raw of primary) {
        const id = String(asUiRecord(raw).id ?? "").trim();
        if (id)
            seen.add(id);
    }
    const extraLists = [
        ...(Array.isArray(productionBatches) ? productionBatches : []),
        ...(Array.isArray(completedSourceBatches) ? completedSourceBatches : []),
    ];
    for (const raw of extraLists) {
        const row = asUiRecord(raw);
        if (!isFreshFrozenSourceRow(row))
            continue;
        const id = String(row.id ?? "").trim();
        if (!id || seen.has(id))
            continue;
        seen.add(id);
        out.push(raw);
    }
    return out;
}

function readFreshFrozenGrams(row: Record<string, unknown>): number | null {
    let g = readNum(row, "grams");
    if (g != null && g > 0)
        return g;
    const lbs = readNum(row, "weightLbs");
    if (lbs != null && lbs > 0)
        return +(lbs * 453.592).toFixed(4);
    const amt = String(row.amount ?? "").trim();
    const m = /(\d[\d,]*)\s*grams?\b/i.exec(amt);
    if (m) {
        const n = Number(String(m[1]).replace(/,/g, ""));
        if (Number.isFinite(n) && n > 0)
            return n;
    }
    return null;
}

/**
 * `dryCanopySqFt` in the client is allocated from **dry** harvest share; FF-only pulls often leave it at 0.
 * Use flower table sq ft × FF plant share when needed.
 */
function resolveFreshFrozenCanopySqFt(ui: Record<string, unknown>): number | null {
    const dry = readNum(ui, "dryCanopySqFt");
    if (dry != null && dry > 0)
        return dry;
    const total = readNum(ui, "totalFlowerTableSqFt");
    if (total == null || total <= 0)
        return null;
    const plantsAtFlower = readNum(ui, "plantsAtFlower") ?? readNum(ui, "plants");
    const denom = plantsAtFlower != null && plantsAtFlower > 0 ? plantsAtFlower : null;
    const plantsFf = readNum(ui, "plantsHarvestedFreshFrozen");
    if (denom != null && plantsFf != null && plantsFf > 0) {
        const frac = Math.min(1, Math.max(0, plantsFf / denom));
        const sq = total * frac;
        if (sq > 0)
            return sq;
    }
    /** Last resort: full selected table footprint (better than dropping FF when counters lag). */
    return total;
}

function readFreshFrozenStemWasteGrams(row: Record<string, unknown>): number | null {
    const w = readNum(row, "freshFrozenStemWasteGrams");
    if (w != null && w >= 0 && Number.isFinite(w))
        return w;
    return null;
}

/**
 * Points from: dry flower batches (lab THC / dry yield), Fresh Frozen source batches (g/sq ft),
 * plus parent cultivation fallback when no in-range dry batch represents that parent.
 */
export function buildCultivationStrainMetricPoints(input: {
    fromMs: number;
    toMs: number;
    strainFilter: string[] | null;
    cultivationRows: CultivationRowInput[];
    dryFlowerBatches: unknown[];
    sourceBatches: unknown[];
}): CultivationStrainMetricPoint[] {
    const {
        fromMs,
        toMs,
        strainFilter,
        cultivationRows,
        dryFlowerBatches,
        sourceBatches,
    } = input;

    const parentById = new Map(
        cultivationRows.map((r) => [r.id, r]),
    );

    const points: CultivationStrainMetricPoint[] = [];
    const parentsWithInRangeDryPoint = new Set<string>();

    const dryList = Array.isArray(dryFlowerBatches) ? dryFlowerBatches : [];

    for (const raw of dryList) {
        const dry = asUiRecord(raw);
        const dryId = String(dry.id ?? "").trim();
        const source = String(dry.source ?? "").trim();
        if (!dryId || !source)
            continue;

        const parent = parentById.get(source);
        if (!parent)
            continue;

        const ac = String(parent.strainAcronym || "").trim().toUpperCase();
        if (strainFilter && strainFilter.length > 0 && !strainFilter.includes(ac))
            continue;

        const potency = readNum(dry, "finalLabPotencyPct");
        const yld = readNum(dry, "dryYieldGPerSqFt");
        const hasPotency = potency != null && Number.isFinite(potency);
        const hasYield = yld != null && Number.isFinite(yld) && yld > 0;
        if (!hasPotency && !hasYield)
            continue;

        if (hasPotency && !dryFlowerLabLooksCommitted(dry))
            continue;

        const fallback = parent.updatedAt;
        const metricDate = resolveMetricDate(dry.finalLabPotencyAt, fallback);
        const t = metricDate.getTime();
        if (t < fromMs || t > toMs)
            continue;

        parentsWithInRangeDryPoint.add(source);

        points.push({
            batchId: dryId,
            strain: String(parent.strain || "").trim() || String(dry.strain ?? "").trim(),
            strainAcronym: ac,
            date: metricDate.toISOString().slice(0, 10),
            potencyPct: hasPotency ? potency : null,
            dryYieldGPerSqFt: hasYield ? yld : null,
            freshFrozenYieldGPerSqFt: null,
            freshFrozenStemWasteGPerSqFt: null,
        });
    }

    const sourceList = Array.isArray(sourceBatches) ? sourceBatches : [];

    for (const raw of sourceList) {
        const sb = asUiRecord(raw);
        if (!isFreshFrozenSourceRow(sb))
            continue;
        const ffId = String(sb.id ?? "").trim();
        const source = String(
            sb.source ?? sb.cultivationBatchId ?? sb.parentCultivationBatch ?? "",
        ).trim();
        if (!ffId || !source)
            continue;

        const parent = parentById.get(source);
        if (!parent)
            continue;

        const ac = String(parent.strainAcronym || "").trim().toUpperCase();
        if (strainFilter && strainFilter.length > 0 && !strainFilter.includes(ac))
            continue;

        const ui = asUiRecord(parent.cultivationUiState);

        let grams = readFreshFrozenGrams(sb);
        const dbFf = parent.freshFrozenGrams;
        if ((grams == null || grams <= 0) && dbFf != null && Number.isFinite(dbFf) && dbFf > 0)
            grams = dbFf;

        const canopy = resolveFreshFrozenCanopySqFt(ui);
        let ffYld: number | null = null;
        if (grams != null && grams > 0 && canopy != null && canopy > 0)
            ffYld = +(grams / canopy).toFixed(4);
        const stemWasteG = readFreshFrozenStemWasteGrams(sb);
        let stemYld: number | null = null;
        if (stemWasteG != null && stemWasteG > 0 && canopy != null && canopy > 0)
            stemYld = +(stemWasteG / canopy).toFixed(4);

        if (
            (ffYld == null || ffYld <= 0 || !Number.isFinite(ffYld))
            && (stemYld == null || stemYld <= 0 || !Number.isFinite(stemYld))
        )
            continue;

        const fallback = parent.updatedAt;
        const harvestAtRaw = sb.createdAt ?? sb.created_at;
        const metricDate = resolveMetricDate(harvestAtRaw, fallback);
        const t = metricDate.getTime();
        if (t < fromMs || t > toMs)
            continue;

        points.push({
            batchId: ffId,
            strain: String(parent.strain || "").trim() || String(sb.strain ?? "").trim(),
            strainAcronym: ac,
            date: metricDate.toISOString().slice(0, 10),
            potencyPct: null,
            dryYieldGPerSqFt: null,
            freshFrozenYieldGPerSqFt: ffYld != null && ffYld > 0 ? ffYld : null,
            freshFrozenStemWasteGPerSqFt: stemYld != null && stemYld > 0 ? stemYld : null,
        });
    }

    for (const row of cultivationRows) {
        if (parentsWithInRangeDryPoint.has(row.id))
            continue;

        const ui = asUiRecord(row.cultivationUiState);
        const ac = String(row.strainAcronym || "").trim().toUpperCase();
        if (strainFilter && strainFilter.length > 0 && !strainFilter.includes(ac))
            continue;

        const potencyRaw = ui.finalLabPotencyPct;
        const yldRaw = ui.dryYieldGPerSqFt;
        const potency = potencyRaw != null && potencyRaw !== "" ? Number(potencyRaw) : null;
        const yld = yldRaw != null && yldRaw !== "" ? Number(yldRaw) : null;
        const hasPotency = potency != null && Number.isFinite(potency);
        const hasYield = yld != null && Number.isFinite(yld) && yld > 0;
        if (!hasPotency && !hasYield)
            continue;

        const atRaw = ui.finalLabPotencyAt;
        const metricDate = resolveMetricDate(atRaw, row.updatedAt);
        const t = metricDate.getTime();
        if (t < fromMs || t > toMs)
            continue;

        points.push({
            batchId: row.id,
            strain: row.strain,
            strainAcronym: ac,
            date: metricDate.toISOString().slice(0, 10),
            potencyPct: hasPotency ? potency : null,
            dryYieldGPerSqFt: hasYield ? yld : null,
            freshFrozenYieldGPerSqFt: null,
            freshFrozenStemWasteGPerSqFt: null,
        });
    }

    points.sort(
        (a, b) =>
            a.date.localeCompare(b.date)
            || a.batchId.localeCompare(b.batchId),
    );

    return points;
}
