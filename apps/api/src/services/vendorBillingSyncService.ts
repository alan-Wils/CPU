import type { UsageProvider } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { logInfo, logWarn } from "../lib/logger.js";
import { syncCloudflareMonth } from "./vendorClients/cloudflareClient.js";
import { buildNeonVendorSyncResult } from "./vendorClients/neonBillingClient.js";
import { NeonUsageAggregationService } from "./neonUsageAggregationService.js";
import { syncOpenAIMonth } from "./vendorClients/openaiUsageClient.js";
import { syncRailwayMonth } from "./vendorClients/railwayClient.js";
import { syncResendMonth } from "./vendorClients/resendClient.js";
import type { VendorSyncResult, VendorSyncStatus } from "./vendorClients/types.js";
import { syncVercelMonth } from "./vendorClients/vercelClient.js";

export type VendorSyncSummaryRow = {
    provider: UsageProvider;
    status: VendorSyncStatus;
    totalCost: number | null;
    currency: string;
    syncedAt: string | null;
    message: string | null;
    source?: string;
};

function utcMonthRange(now: Date): { monthStart: Date; nextMonthStart: Date; label: string } {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const monthStart = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
    const nextMonthStart = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0));
    const label = `${y}-${String(m + 1).padStart(2, "0")}`;
    return { monthStart, nextMonthStart, label };
}

/** Exported for admin usage-costs listing. */
export function utcMonthLabel(now: Date = new Date()): string {
    return utcMonthRange(now).label;
}

type PersistInput = VendorSyncResult & {
    billingPeriodStart?: Date | null;
    billingPeriodEnd?: Date | null;
    source?: "vendor_api" | "manual" | "estimated";
    errorMessage?: string | null;
};

async function persistSnapshot(month: string, row: PersistInput): Promise<void> {
    const prev = await prisma.vendorBillingSnapshot.findUnique({
        where: { provider_month: { provider: row.provider, month } },
    });
    /** Do not overwrite a manual MTD total with automated sync (still refresh raw metrics elsewhere). */
    if (prev?.source === "manual" && row.source !== "manual") {
        await prisma.vendorBillingSnapshot.update({
            where: { provider_month: { provider: row.provider, month } },
            data: {
                rawUsageJson: row.rawUsageJson ?? prev.rawUsageJson ?? undefined,
                syncedAt: row.syncedAt ?? new Date(),
                errorMessage: row.errorMessage ?? null,
                billingPeriodStart: row.billingPeriodStart ?? prev.billingPeriodStart,
                billingPeriodEnd: row.billingPeriodEnd ?? prev.billingPeriodEnd,
            },
        });
        return;
    }

    const totalCost =
        row.totalCost == null || !Number.isFinite(row.totalCost) ? null : Number(row.totalCost);

    await prisma.vendorBillingSnapshot.upsert({
        where: { provider_month: { provider: row.provider, month } },
        create: {
            provider: row.provider,
            month,
            totalCost,
            currency: row.currency || "USD",
            rawUsageJson: row.rawUsageJson,
            status: row.status,
            syncedAt: row.syncedAt ?? null,
            billingPeriodStart: row.billingPeriodStart ?? null,
            billingPeriodEnd: row.billingPeriodEnd ?? null,
            source: row.source ?? "estimated",
            errorMessage: row.errorMessage ?? null,
        },
        update: {
            totalCost,
            currency: row.currency || "USD",
            rawUsageJson: row.rawUsageJson,
            status: row.status,
            syncedAt: row.syncedAt ?? null,
            billingPeriodStart: row.billingPeriodStart ?? null,
            billingPeriodEnd: row.billingPeriodEnd ?? null,
            source: row.source ?? "estimated",
            errorMessage: row.errorMessage ?? null,
        },
    });
}

export class VendorBillingSyncService {
    async syncCurrentMonthAllProviders(): Promise<{ month: string; results: VendorSyncSummaryRow[] }> {
        const now = new Date();
        const { monthStart, nextMonthStart, label } = utcMonthRange(now);
        const neonAggService = new NeonUsageAggregationService();
        const neonAgg = await neonAggService.aggregateMonth(monthStart, nextMonthStart);
        const neonResult = await buildNeonVendorSyncResult(monthStart, nextMonthStart, {
            status: neonAgg.status,
            totalCost: neonAgg.totalCost,
            currency: neonAgg.currency,
            metrics: neonAgg.metrics,
            diagnostics: neonAgg.diagnostics,
        });

        const results = await Promise.all([
            syncVercelMonth(),
            syncRailwayMonth(),
            Promise.resolve(neonResult),
            syncResendMonth(),
            syncCloudflareMonth(),
            syncOpenAIMonth(monthStart, nextMonthStart),
        ]);

        const mapped: VendorSyncSummaryRow[] = [];
        for (const row of results) {
            if (row.provider === "resend") {
                logInfo("[VENDOR_SYNC] resend_probe_complete", {
                    month: label,
                    status: row.status,
                    message: row.message ?? null,
                    syncedAt: row.syncedAt ? row.syncedAt.toISOString() : null,
                });
            }
            try {
                await persistSnapshot(label, {
                    ...row,
                    source: row.source ?? "estimated",
                    billingPeriodStart: row.billingPeriodStart ?? monthStart,
                    billingPeriodEnd: row.billingPeriodEnd ?? new Date(nextMonthStart.getTime() - 1),
                });
            }
            catch (error) {
                logWarn("[VENDOR_SYNC] snapshot_upsert_failed", {
                    provider: row.provider,
                    month: label,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
            mapped.push({
                provider: row.provider,
                status: row.status,
                totalCost: row.totalCost,
                currency: row.currency || "USD",
                syncedAt: row.syncedAt ? row.syncedAt.toISOString() : null,
                message: row.message ?? null,
                source: row.source ?? "estimated",
            });
        }

        logInfo("[VENDOR_SYNC] sync_complete", {
            month: label,
            providers: mapped.map((x) => ({ provider: x.provider, status: x.status })),
        });

        return { month: label, results: mapped };
    }

    async saveManualOverride(input: {
        provider: UsageProvider;
        month: string;
        totalCostUsd: number;
        billingPeriodStart?: Date | null;
        billingPeriodEnd?: Date | null;
        rawUsageJson?: Record<string, unknown> | null;
    }): Promise<void> {
        const month = String(input.month || "").trim();
        if (!/^\d{4}-\d{2}$/.test(month))
            throw new Error("month must be YYYY-MM");
        const row: PersistInput = {
            provider: input.provider,
            status: "live_synced",
            totalCost: input.totalCostUsd,
            currency: "USD",
            rawUsageJson: (input.rawUsageJson ?? undefined) as PersistInput["rawUsageJson"],
            message: "Manual vendor MTD override",
            syncedAt: new Date(),
            billingPeriodStart: input.billingPeriodStart ?? null,
            billingPeriodEnd: input.billingPeriodEnd ?? null,
            source: "manual",
            errorMessage: null,
        };
        await persistSnapshot(month, row);
    }

    async listSnapshotsForMonth(month: string): Promise<
        Array<{
            id: string;
            provider: UsageProvider;
            month: string;
            totalCost: number | null;
            currency: string;
            status: string;
            source: string;
            syncedAt: string | null;
            billingPeriodStart: string | null;
            billingPeriodEnd: string | null;
            errorMessage: string | null;
            rawUsageJson: unknown;
        }>
    > {
        const rows = await prisma.vendorBillingSnapshot.findMany({
            where: { month },
            orderBy: { provider: "asc" },
        });
        return rows.map((r) => ({
            id: r.id,
            provider: r.provider,
            month: r.month,
            totalCost: r.totalCost,
            currency: r.currency,
            status: r.status,
            source: r.source,
            syncedAt: r.syncedAt ? r.syncedAt.toISOString() : null,
            billingPeriodStart: r.billingPeriodStart ? r.billingPeriodStart.toISOString() : null,
            billingPeriodEnd: r.billingPeriodEnd ? r.billingPeriodEnd.toISOString() : null,
            errorMessage: r.errorMessage,
            rawUsageJson: r.rawUsageJson,
        }));
    }
}
