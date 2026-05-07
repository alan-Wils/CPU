import type { UsageProvider } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { logInfo, logWarn } from "../lib/logger.js";
import { syncCloudflareMonth } from "./vendorClients/cloudflareClient.js";
import { syncNeonMonth } from "./vendorClients/neonClient.js";
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
};

function utcMonthRange(now: Date): { monthStart: Date; nextMonthStart: Date; label: string } {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const monthStart = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
    const nextMonthStart = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0));
    const label = `${y}-${String(m + 1).padStart(2, "0")}`;
    return { monthStart, nextMonthStart, label };
}

async function persistSnapshot(month: string, row: VendorSyncResult): Promise<void> {
    await prisma.vendorBillingSnapshot.upsert({
        where: { provider_month: { provider: row.provider, month } },
        create: {
            provider: row.provider,
            month,
            totalCost: Number.isFinite(row.totalCost ?? NaN) ? Number(row.totalCost) : 0,
            currency: row.currency || "USD",
            rawUsageJson: row.rawUsageJson,
            status: row.status,
            syncedAt: row.syncedAt ?? null,
        },
        update: {
            totalCost: Number.isFinite(row.totalCost ?? NaN) ? Number(row.totalCost) : 0,
            currency: row.currency || "USD",
            rawUsageJson: row.rawUsageJson,
            status: row.status,
            syncedAt: row.syncedAt ?? null,
        },
    });
}

export class VendorBillingSyncService {
    async syncCurrentMonthAllProviders(): Promise<{ month: string; results: VendorSyncSummaryRow[] }> {
        const now = new Date();
        const { monthStart, nextMonthStart, label } = utcMonthRange(now);
        const results = await Promise.all([
            syncVercelMonth(),
            syncRailwayMonth(),
            syncNeonMonth(),
            syncResendMonth(),
            syncCloudflareMonth(),
            syncOpenAIMonth(monthStart, nextMonthStart),
        ]);

        const mapped: VendorSyncSummaryRow[] = [];
        for (const row of results) {
            try {
                await persistSnapshot(label, row);
            } catch (error) {
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
            });
        }

        logInfo("[VENDOR_SYNC] sync_complete", {
            month: label,
            providers: mapped.map((x) => ({ provider: x.provider, status: x.status })),
        });

        return { month: label, results: mapped };
    }
}

