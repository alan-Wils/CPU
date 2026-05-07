import type { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import type { VendorSyncResult } from "./types.js";

export async function syncNeonMonth(): Promise<VendorSyncResult> {
    const token = env.NEON_API_KEY;
    if (!token) {
        return {
            provider: "neon",
            status: "missing_token",
            totalCost: null,
            currency: "USD",
            syncedAt: null,
            message: "NEON_API_KEY is not configured",
        };
    }
    try {
        const res = await fetch("https://console.neon.tech/api/v2/projects", {
            headers: { Authorization: `Bearer ${token}` },
        });
        const rawText = await res.text();
        if (!res.ok) {
            return {
                provider: "neon",
                status: "sync_failed",
                totalCost: null,
                currency: "USD",
                syncedAt: null,
                message: `Neon API failed (${res.status})`,
                rawUsageJson: { preview: rawText.slice(0, 500) } as Prisma.InputJsonValue,
            };
        }
        const payload = rawText ? JSON.parse(rawText) : {};
        return {
            provider: "neon",
            status: "estimated_only",
            totalCost: null,
            currency: "USD",
            syncedAt: new Date(),
            message: "Neon billing total endpoint is not currently mapped in this backend.",
            rawUsageJson: payload as Prisma.InputJsonValue,
        };
    } catch (error) {
        return {
            provider: "neon",
            status: "sync_failed",
            totalCost: null,
            currency: "USD",
            syncedAt: null,
            message: error instanceof Error ? error.message : String(error),
        };
    }
}

