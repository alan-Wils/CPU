/** Build analytics points from cultivation rows + company-store dry flower batches. */

export type CultivationStrainMetricPoint = {
    batchId: string;
    strain: string;
    strainAcronym: string;
    date: string;
    potencyPct: number | null;
    dryYieldGPerSqFt: number | null;
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
    return fallback;
}

/**
 * One point per dry flower batch that recorded lab THC / yield, plus parent cultivation rows
 * when no in-range dry batch represents that parent (legacy or store not synced).
 */
export function buildCultivationStrainMetricPoints(input: {
    fromMs: number;
    toMs: number;
    strainFilter: string[] | null;
    cultivationRows: CultivationRowInput[];
    dryFlowerBatches: unknown[];
}): CultivationStrainMetricPoint[] {
    const { fromMs, toMs, strainFilter, cultivationRows, dryFlowerBatches } = input;

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
        });
    }

    points.sort(
        (a, b) =>
            a.date.localeCompare(b.date)
            || a.batchId.localeCompare(b.batchId),
    );

    return points;
}
