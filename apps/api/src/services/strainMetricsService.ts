import { prisma } from "../config/prisma.js";
import { logInfo } from "../lib/logger.js";
import { ConfigService } from "./configService.js";
import { mergeStrainAutoMetricsIntoCultivation } from "./strainMetricsMerge.js";

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
        const cultivation = cultRow.value as Record<string, unknown>;
        const nowIso = new Date().toISOString();
        const merged = mergeStrainAutoMetricsIntoCultivation(cultivation, byAcronym, nowIso);
        await this.configService.upsert({
            companyId,
            actorUserId,
            key: "cultivation",
            value: merged
        });
        logInfo("[STRAIN_METRICS] config_updated", { companyId });
    }
}
