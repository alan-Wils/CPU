/** Build analytics points from cultivation rows + company-store dry flower batches. */

export type CultivationStrainMetricPoint = {
    batchId: string;
    strain: string;
    strainAcronym: string;
    date: string;
    potencyPct: number | null;
    dryYieldGPerSqFt: number | null;
    /** Grams per sq ft from Fresh Frozen source-batch harvest ÷ parent `dryCanopySqFt`. */
    freshFrozenYieldGPerSqFt: number | null;
};

type CultivationRowInput = {
    id: string;
    strain: string;
    strainAcronym: string;
    updatedAt: Date;
    cultivationUiState: unknown;
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

function readFreshFrozenGrams(row: Record<string, unknown>): number | null {
    let g = readNum(row, "grams");
    if (g != null && g > 0)
        return g;
    const lbs = readNum(row, "weightLbs");
    if (lbs != null && lbs > 0)
        return +(lbs * 453.592).toFixed(4);
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
        });
    }

    const sourceList = Array.isArray(sourceBatches) ? sourceBatches : [];

    for (const raw of sourceList) {
        const sb = asUiRecord(raw);
        if (!isFreshFrozenSourceRow(sb))
            continue;
        const ffId = String(sb.id ?? "").trim();
        const source = String(sb.source ?? "").trim();
        if (!ffId || !source)
            continue;

        const parent = parentById.get(source);
        if (!parent)
            continue;

        const ac = String(parent.strainAcronym || "").trim().toUpperCase();
        if (strainFilter && strainFilter.length > 0 && !strainFilter.includes(ac))
            continue;

        const grams = readFreshFrozenGrams(sb);
        const ui = asUiRecord(parent.cultivationUiState);
        const canopy = readNum(ui, "dryCanopySqFt");
        let ffYld: number | null = null;
        if (grams != null && grams > 0 && canopy != null && canopy > 0)
            ffYld = +(grams / canopy).toFixed(4);
        if (ffYld == null || ffYld <= 0 || !Number.isFinite(ffYld))
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
            freshFrozenYieldGPerSqFt: ffYld,
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
        });
    }

    points.sort(
        (a, b) =>
            a.date.localeCompare(b.date)
            || a.batchId.localeCompare(b.batchId),
    );

    return points;
}
