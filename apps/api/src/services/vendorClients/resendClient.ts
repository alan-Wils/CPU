import type { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import type { VendorSyncResult } from "./types.js";

export async function syncResendMonth(): Promise<VendorSyncResult> {
    const token = env.RESEND_API_KEY;
    if (!token) {
        return {
            provider: "resend",
            status: "missing_token",
            totalCost: null,
            currency: "USD",
            syncedAt: null,
            message: "RESEND_API_KEY is not configured",
        };
    }
    try {
        const res = await fetch("https://api.resend.com/domains", {
            headers: { Authorization: `Bearer ${token}` },
        });
        const rawText = await res.text();
        if (!res.ok) {
            return {
                provider: "resend",
                status: "sync_failed",
                totalCost: null,
                currency: "USD",
                syncedAt: null,
                message: `Resend API failed (${res.status})`,
                rawUsageJson: { preview: rawText.slice(0, 500) } as Prisma.InputJsonValue,
            };
        }
        const payload = rawText ? JSON.parse(rawText) : {};
        return {
            provider: "resend",
            status: "unsupported",
            totalCost: null,
            currency: "USD",
            syncedAt: new Date(),
            message: "Resend billing total endpoint is not currently mapped in this backend.",
            rawUsageJson: payload as Prisma.InputJsonValue,
        };
    } catch (error) {
        return {
            provider: "resend",
            status: "sync_failed",
            totalCost: null,
            currency: "USD",
            syncedAt: null,
            message: error instanceof Error ? error.message : String(error),
        };
    }
}

