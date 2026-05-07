import type { Prisma, UsageProvider } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { logWarn } from "../lib/logger.js";

export type RecordUsageEventInput = {
    companyId: string;
    provider: UsageProvider;
    feature: string;
    unitType: string;
    units: number;
    estimatedCost?: number;
    metadata?: Prisma.InputJsonValue;
};

/** Fallback $ estimates per unit when `estimatedCost` is omitted (rough SaaS placeholders). */
const DEFAULT_UNIT_RATE: Partial<Record<UsageProvider, number>> = {
    resend: 0.0004,
    ai: 0.002,
    cloudflare_r2: 0.00002,
    neon: 1e-8,
    railway: 0.0005,
    vercel: 0.0003,
};

/**
 * Persists a usage row for NexBatch cost dashboards. Never throws — failures are logged only.
 */
export async function recordUsageEventSafe(input: RecordUsageEventInput): Promise<void> {
    const cid = String(input.companyId || "").trim();
    if (!cid)
        return;
    let cost = input.estimatedCost;
    if (cost == null || !Number.isFinite(cost)) {
        const rate = DEFAULT_UNIT_RATE[input.provider];
        cost = rate != null ? rate * Math.max(0, input.units) : 0;
    }
    try {
        await prisma.usageEvent.create({
            data: {
                companyId: cid,
                provider: input.provider,
                feature: String(input.feature || "unknown").slice(0, 240),
                unitType: String(input.unitType || "units").slice(0, 120),
                units: Number.isFinite(input.units) ? input.units : 0,
                estimatedCost: Number.isFinite(cost) ? cost : 0,
                metadata: input.metadata === undefined ? undefined : (input.metadata as Prisma.InputJsonValue),
            },
        });
    }
    catch (error) {
        logWarn("[USAGE_EVENT] record_failed", {
            companyId: cid,
            provider: input.provider,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
