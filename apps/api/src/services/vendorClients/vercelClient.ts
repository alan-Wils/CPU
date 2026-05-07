import type { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import type { VendorSyncResult } from "./types.js";

export async function syncVercelMonth(): Promise<VendorSyncResult> {
    const token = env.VERCEL_API_TOKEN;
    if (!token) {
        return {
            provider: "vercel",
            status: "missing_token",
            totalCost: null,
            currency: "USD",
            syncedAt: null,
            message: "VERCEL_API_TOKEN is not configured",
        };
    }
    try {
        const res = await fetch("https://api.vercel.com/v2/user", {
            headers: { Authorization: `Bearer ${token}` },
        });
        const rawText = await res.text();
        if (!res.ok) {
            return {
                provider: "vercel",
                status: "sync_failed",
                totalCost: null,
                currency: "USD",
                syncedAt: null,
                message: `Vercel API failed (${res.status})`,
                rawUsageJson: { preview: rawText.slice(0, 500) } as Prisma.InputJsonValue,
            };
        }
        const payload = rawText ? JSON.parse(rawText) : {};
        return {
            provider: "vercel",
            status: "unsupported",
            totalCost: null,
            currency: "USD",
            syncedAt: new Date(),
            message: "Vercel billing total endpoint is not currently mapped in this backend.",
            rawUsageJson: payload as Prisma.InputJsonValue,
        };
    } catch (error) {
        return {
            provider: "vercel",
            status: "sync_failed",
            totalCost: null,
            currency: "USD",
            syncedAt: null,
            message: error instanceof Error ? error.message : String(error),
        };
    }
}

