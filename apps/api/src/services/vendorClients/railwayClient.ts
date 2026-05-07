import type { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import type { VendorSyncResult } from "./types.js";

export async function syncRailwayMonth(): Promise<VendorSyncResult> {
    const token = env.RAILWAY_API_TOKEN;
    if (!token) {
        return {
            provider: "railway",
            status: "missing_token",
            totalCost: null,
            currency: "USD",
            syncedAt: null,
            message: "RAILWAY_API_TOKEN is not configured",
        };
    }
    try {
        const query = { query: "query { me { id email } }" };
        const res = await fetch("https://backboard.railway.app/graphql/v2", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(query),
        });
        const rawText = await res.text();
        if (!res.ok) {
            return {
                provider: "railway",
                status: "sync_failed",
                totalCost: null,
                currency: "USD",
                syncedAt: null,
                message: `Railway API failed (${res.status})`,
                rawUsageJson: { preview: rawText.slice(0, 500) } as Prisma.InputJsonValue,
            };
        }
        const payload = rawText ? JSON.parse(rawText) : {};
        return {
            provider: "railway",
            status: "unsupported",
            totalCost: null,
            currency: "USD",
            syncedAt: new Date(),
            message: "Railway billing total endpoint is not currently mapped in this backend.",
            rawUsageJson: payload as Prisma.InputJsonValue,
        };
    } catch (error) {
        return {
            provider: "railway",
            status: "sync_failed",
            totalCost: null,
            currency: "USD",
            syncedAt: null,
            message: error instanceof Error ? error.message : String(error),
        };
    }
}

