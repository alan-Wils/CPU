import type { Prisma, UsageProvider } from "@prisma/client";

export type VendorSyncStatus =
    | "connected"
    | "missing_token"
    | "sync_failed"
    | "unsupported"
    | "estimated_only";

export type VendorSyncResult = {
    provider: UsageProvider;
    status: VendorSyncStatus;
    totalCost: number | null;
    currency: string;
    rawUsageJson?: Prisma.InputJsonValue;
    message?: string;
    syncedAt: Date | null;
};

