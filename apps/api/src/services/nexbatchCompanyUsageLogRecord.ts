import type { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { logWarn } from "../lib/logger.js";

/**
 * NexBatch-initiated operational usage (staff actions, diagnostics, etc.),
 * written **once per attached company** with evenly split fractional units/cost when an action spans many tenants.
 * Never throws.
 */
export async function recordNexbatchPlatformUsageSplitAcrossCompaniesSafe(input: {
    companyIds: string[];
    feature: string;
    unitType: string;
    totalUnits: number;
    totalEstimatedCost: number;
    provider: string;
    actorUserId?: string | null;
    category?: string;
    metadata?: Prisma.InputJsonValue;
}): Promise<void> {
    const ids = input.companyIds.map((id) => String(id || "").trim()).filter(Boolean);
    const n = ids.length;
    if (n === 0)
        return;
    const unitsPer = Math.max(0, Number(input.totalUnits) || 0) / n;
    const costPer = Math.max(0, Number(input.totalEstimatedCost) || 0) / n;
    const category = String(input.category || "nexbatch_platform").slice(0, 120);
    try {
        await prisma.$transaction(
            ids.map((companyId) =>
                prisma.nexbatchCompanyUsageLog.create({
                    data: {
                        companyId,
                        actorUserId: input.actorUserId ? String(input.actorUserId).trim() : null,
                        feature: String(input.feature || "unknown").slice(0, 240),
                        category,
                        provider: String(input.provider || "unknown").slice(0, 80),
                        unitType: String(input.unitType || "units").slice(0, 120),
                        units: unitsPer,
                        estimatedCost: costPer,
                        metadata: input.metadata === undefined ? undefined : (input.metadata as Prisma.InputJsonValue),
                    },
                }),
            ),
        );
    }
    catch (error) {
        logWarn("[NEXBATCH_COMPANY_USAGE_LOG] write_failed", {
            feature: input.feature,
            companyCount: n,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
