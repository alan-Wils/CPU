import type { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import type { VendorSyncResult } from "./types.js";

function toUnixSeconds(d: Date): number {
    return Math.floor(d.getTime() / 1000);
}

export async function syncOpenAIMonth(monthStart: Date, nextMonthStart: Date): Promise<VendorSyncResult> {
    const token = env.OPENAI_API_KEY;
    if (!token) {
        return {
            provider: "ai",
            status: "missing_token",
            totalCost: null,
            currency: "USD",
            syncedAt: null,
            message: "OPENAI_API_KEY is not configured",
        };
    }
    try {
        const base = (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
        const startTime = toUnixSeconds(monthStart);
        const endTime = toUnixSeconds(nextMonthStart);
        const url = `${base}/organization/costs?start_time=${encodeURIComponent(String(startTime))}&end_time=${encodeURIComponent(String(endTime))}`;
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const rawText = await res.text();
        if (!res.ok) {
            return {
                provider: "ai",
                status: "sync_failed",
                totalCost: null,
                currency: "USD",
                syncedAt: null,
                message: `OpenAI usage API failed (${res.status})`,
                rawUsageJson: { preview: rawText.slice(0, 600) } as Prisma.InputJsonValue,
            };
        }
        const payload = rawText ? (JSON.parse(rawText) as { data?: Array<{ amount?: { value?: number } }> }) : {};
        const rows = Array.isArray(payload.data) ? payload.data : [];
        const totalCost = rows.reduce((sum, row) => sum + (Number(row?.amount?.value) || 0), 0);
        return {
            provider: "ai",
            status: "connected",
            totalCost,
            currency: "USD",
            syncedAt: new Date(),
            rawUsageJson: (payload as Prisma.InputJsonValue),
        };
    } catch (error) {
        return {
            provider: "ai",
            status: "sync_failed",
            totalCost: null,
            currency: "USD",
            syncedAt: null,
            message: error instanceof Error ? error.message : String(error),
        };
    }
}

