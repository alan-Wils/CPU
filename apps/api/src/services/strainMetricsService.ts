import { prisma } from "../config/prisma.js";
import { logInfo } from "../lib/logger.js";
import { ConfigService } from "./configService.js";

function asUiRecord(value: unknown): Record<string, unknown> {
    if (value === null || value === undefined)
        return {};
    if (typeof value !== "object" || Array.isArray(value))
        return {};
    return value as Record<string, unknown>;
}

function meanFinite(values: number[]): number | null {
    const xs = values.filter((x) => typeof x === "number" && Number.isFinite(x));
    if (xs.length === 0)
        return null;
    return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function readNum(ui: Record<string, unknown>, key: string): number | null {
    const v = ui[key];
    if (v == null)
        return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * Recompute per-strain auto averages from `CultivationBatch.cultivationUiState` and upsert `CompanyConfig` key `cultivation`.
 */
export class StrainMetricsService {
    configService = new ConfigService();

    async recomputeStrainAutoMetricsForCompany(input: { companyId: string; actorUserId: string }) {
        const { companyId, actorUserId } = input;
        const batches = await prisma.cultivationBatch.findMany({
            where: { companyId },
            take: 500,
            orderBy: { updatedAt: "desc" }
        });
        const byAcronym = new Map<string, { potencies: number[]; yields: number[] }>();
        for (const row of batches) {
            const ui = asUiRecord(row.cultivationUiState);
            const pct = readNum(ui, "finalLabPotencyPct");
            const yld = readNum(ui, "dryYieldGPerSqFt");
            const ac = String(row.strainAcronym || "").trim().toUpperCase();
            if (!ac)
                continue;
            if (pct == null && (yld == null || yld <= 0))
                continue;
            let entry = byAcronym.get(ac);
            if (!entry) {
                entry = { potencies: [], yields: [] };
                byAcronym.set(ac, entry);
            }
            if (pct != null)
                entry.potencies.push(pct);
            if (yld != null && yld > 0)
                entry.yields.push(yld);
        }
        const rows = await this.configService.list(companyId);
        const cultRow = rows.find((r) => r.key === "cultivation");
        if (!cultRow?.value || typeof cultRow.value !== "object" || Array.isArray(cultRow.value)) {
            logInfo("[STRAIN_METRICS] skip_no_cultivation_config", { companyId });
            return;
        }
        const cultivation: Record<string, unknown> = { ...(cultRow.value as Record<string, unknown>) };
        const strainsRaw = cultivation.strains;
        const strains = Array.isArray(strainsRaw) ? [...strainsRaw] : [];
        const nowIso = new Date().toISOString();
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
            if (avgP != null)
                strain.autoAvgPotencyPct = +avgP.toFixed(4);
            if (avgY != null)
                strain.autoAvgDryYieldGPerSqFt = +avgY.toFixed(4);
            strain.autoMetricsSampleCount = Math.max(nP, nY);
            strain.autoMetricsUpdatedAt = nowIso;
            strains[i] = strain;
        }
        cultivation.strains = strains;
        await this.configService.upsert({
            companyId,
            actorUserId,
            key: "cultivation",
            value: cultivation
        });
        logInfo("[STRAIN_METRICS] config_updated", { companyId });
    }
}
