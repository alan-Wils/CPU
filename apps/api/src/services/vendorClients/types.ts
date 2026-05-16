import type { Prisma, UsageProvider } from "@prisma/client";

export type VendorSyncStatus =
    | "live_synced"
    | "missing_token"
    | "sync_failed"
    | "estimated_only";

export type VendorSyncResult = {
    provider: UsageProvider;
    status: VendorSyncStatus;
    totalCost: number | null;
    currency: string;
    rawUsageJson?: Prisma.InputJsonValue;
    message?: string;
    syncedAt: Date | null;
    billingPeriodStart?: Date | null;
    billingPeriodEnd?: Date | null;
    source?: "vendor_api" | "manual" | "estimated";
    errorMessage?: string | null;
};

