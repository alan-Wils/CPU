import type { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import type { VendorSyncResult } from "./types.js";

export async function syncCloudflareMonth(): Promise<VendorSyncResult> {
    const token = env.CLOUDFLARE_API_TOKEN;
    if (!token) {
        return {
            provider: "cloudflare_r2",
            status: "missing_token",
            totalCost: null,
            currency: "USD",
            syncedAt: null,
            message: "CLOUDFLARE_API_TOKEN is not configured",
        };
    }
    try {
        const res = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
            headers: { Authorization: `Bearer ${token}` },
        });
        const rawText = await res.text();
        if (!res.ok) {
            return {
                provider: "cloudflare_r2",
                status: "sync_failed",
                totalCost: null,
                currency: "USD",
                syncedAt: null,
                message: `Cloudflare API failed (${res.status})`,
                rawUsageJson: { preview: rawText.slice(0, 500) } as Prisma.InputJsonValue,
            };
        }
        const payload = rawText ? JSON.parse(rawText) : {};
        return {
            provider: "cloudflare_r2",
            status: "unsupported",
            totalCost: null,
            currency: "USD",
            syncedAt: new Date(),
            message: "Cloudflare R2 billing total endpoint is not currently mapped in this backend.",
            rawUsageJson: payload as Prisma.InputJsonValue,
        };
    } catch (error) {
        return {
            provider: "cloudflare_r2",
            status: "sync_failed",
            totalCost: null,
            currency: "USD",
            syncedAt: null,
            message: error instanceof Error ? error.message : String(error),
        };
    }
}

