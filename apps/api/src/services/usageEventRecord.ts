import type { Prisma, UsageProvider } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import {
    estimateNeonMetricCostUsd,
    estimateStorageMbFromRowsWritten,
    type NeonUsageMetric,
} from "../config/neonUsagePricing.js";
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

export type RecordDbUsageInput = {
    companyId: string;
    metric: NeonUsageMetric;
    units: number;
    feature: string;
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

/**
 * Internal Neon usage logging for tenant-scoped DB attribution.
 */
export async function incrementDbUsage(input: RecordDbUsageInput): Promise<void> {
    const metric = String(input.metric || "").trim() as NeonUsageMetric;
    const units = Number.isFinite(input.units) ? input.units : 0;
    await recordUsageEventSafe({
        companyId: input.companyId,
        provider: "neon",
        feature: input.feature,
        unitType: metric,
        units,
        estimatedCost: estimateNeonMetricCostUsd(metric, units),
        metadata: input.metadata,
    });
}

/**
 * Convenience helper for multi-metric DB activity in one call.
 */
export async function logDatabaseActivity(input: {
    companyId: string;
    feature: string;
    dbReads?: number;
    dbWrites?: number;
    rowsRead?: number;
    rowsWritten?: number;
    queryCount?: number;
    storageMb?: number;
    metadata?: Prisma.InputJsonValue;
}): Promise<void> {
    const rowsWritten = Math.max(0, Number(input.rowsWritten || 0));
    const storageEstimate = Number(input.storageMb || 0) > 0
        ? Number(input.storageMb)
        : rowsWritten > 0
            ? estimateStorageMbFromRowsWritten(rowsWritten)
            : 0;
    const rows: Array<{ metric: NeonUsageMetric; units: number }> = [
        { metric: "db_read", units: Number(input.dbReads || 0) },
        { metric: "db_write", units: Number(input.dbWrites || 0) },
        { metric: "rows_read", units: Number(input.rowsRead || 0) },
        { metric: "rows_written", units: rowsWritten },
        { metric: "query", units: Number(input.queryCount || 0) },
        { metric: "storage_mb", units: storageEstimate },
    ];
    await Promise.all(rows
        .filter((r) => Number.isFinite(r.units) && r.units > 0)
        .map((r) => incrementDbUsage({
        companyId: input.companyId,
        metric: r.metric,
        units: r.units,
        feature: input.feature,
        metadata: input.metadata,
    })));
}
