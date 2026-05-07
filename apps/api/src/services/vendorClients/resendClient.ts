import type { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import type { VendorSyncResult } from "./types.js";

function resendProbeMessage(status: number, rawPreview: string): string {
    if (status === 401 || status === 403) {
        return "Resend returned 401/403 — the RESEND_API_KEY is missing, revoked, or lacks permission for this endpoint. Rotate the key or grant API access.";
    }
    if (status === 429) {
        return `Resend rate-limited (${status}). Retry vendor sync shortly. Preview: ${rawPreview.slice(0, 240)}`;
    }
    return `Resend API request failed (${status}). Preview: ${rawPreview.slice(0, 400)}`;
}

export async function syncResendMonth(): Promise<VendorSyncResult> {
    const token = env.RESEND_API_KEY?.trim();
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
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json",
            },
        });
        const rawText = await res.text();
        const preview = rawText.slice(0, 500);

        if (!res.ok) {
            return {
                provider: "resend",
                status: "sync_failed",
                totalCost: null,
                currency: "USD",
                syncedAt: null,
                message: resendProbeMessage(res.status, preview),
                rawUsageJson: {
                    probe: "/domains",
                    httpStatus: res.status,
                    preview,
                } as Prisma.InputJsonValue,
            };
        }

        let payload: unknown = {};
        if (rawText.trim()) {
            try {
                payload = JSON.parse(rawText) as unknown;
            }
            catch {
                return {
                    provider: "resend",
                    status: "sync_failed",
                    totalCost: null,
                    currency: "USD",
                    syncedAt: null,
                    message: "Resend returned a non-JSON body on success — verify SDK/API compatibility.",
                    rawUsageJson: { probe: "/domains", httpStatus: res.status, preview } as Prisma.InputJsonValue,
                };
            }
        }

        return {
            provider: "resend",
            status: "estimated_only",
            totalCost: null,
            currency: "USD",
            syncedAt: new Date(),
            message: "Resend connection verified; vendor billing totals are not live-mapped — usage uses internal email events.",
            rawUsageJson: payload as Prisma.InputJsonValue,
        };
    }
    catch (error) {
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

