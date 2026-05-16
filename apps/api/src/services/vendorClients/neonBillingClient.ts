import type { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import { logInfo, logWarn } from "../../lib/logger.js";
import type { VendorSyncResult, VendorSyncStatus } from "./types.js";

const CONSUMPTION_URL = "https://console.neon.tech/api/v2/consumption_history/v2/projects";

const CONSUMPTION_METRICS = [
    "compute_unit_seconds",
    "root_branch_bytes_month",
    "child_branch_bytes_month",
    "instant_restore_bytes_month",
    "public_network_transfer_bytes",
    "private_network_transfer_bytes",
    "extra_branches_month",
    "snapshot_storage_bytes_month",
] as const;

type ConsumptionAgg = Record<string, number>;

function emptyAgg(): ConsumptionAgg {
    const o: ConsumptionAgg = {};
    for (const m of CONSUMPTION_METRICS)
        o[m] = 0;
    return o;
}

function mergeMetric(dest: ConsumptionAgg, name: string, value: number): void {
    if (!Number.isFinite(value) || value < 0)
        return;
    const prev = dest[name] ?? 0;
    /** Neon daily buckets are incremental usage for the day for most counters; sum MTD. */
    dest[name] = prev + value;
}

/**
 * Fetch Neon project consumption (Launch+ plans). Does not return invoice USD — store metrics in `rawUsageJson`
 * and pair with `POST /api/admin/usage-costs/manual-override` for dashboard MTD totals.
 */
export async function fetchNeonProjectConsumptionMtd(
    monthStart: Date,
    monthEndExclusive: Date,
): Promise<{
    ok: boolean;
    httpStatus: number;
    message: string;
    aggregated: ConsumptionAgg;
    rawPreview: Prisma.InputJsonValue | undefined;
}> {
    const apiKey = String(env.NEON_API_KEY || "").trim();
    const orgId = String(env.NEON_ORG_ID || "").trim();
    const projectId = String(env.NEON_PROJECT_ID || "").trim();
    if (!apiKey) {
        return {
            ok: false,
            httpStatus: 0,
            message: "NEON_API_KEY is not configured",
            aggregated: emptyAgg(),
            rawPreview: undefined,
        };
    }
    if (!orgId || !projectId) {
        return {
            ok: false,
            httpStatus: 0,
            message: "NEON_ORG_ID and NEON_PROJECT_ID are required for Neon consumption metrics API",
            aggregated: emptyAgg(),
            rawPreview: undefined,
        };
    }
    const from = monthStart.toISOString();
    const to = new Date(Math.min(Date.now(), monthEndExclusive.getTime() - 1)).toISOString();
    const url = new URL(CONSUMPTION_URL);
    url.searchParams.set("org_id", orgId);
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    url.searchParams.set("granularity", "daily");
    url.searchParams.set("project_ids", projectId);
    for (const m of CONSUMPTION_METRICS)
        url.searchParams.append("metrics", m);

    try {
        const res = await fetch(url.toString(), {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: "application/json",
            },
        });
        const text = await res.text();
        let parsed: unknown = {};
        try {
            parsed = text ? JSON.parse(text) : {};
        }
        catch {
            parsed = { parseError: true, preview: text.slice(0, 400) };
        }
        if (!res.ok) {
            const msg =
                res.status === 403
                    ? "Neon consumption API not available for this plan (403). Use manual MTD override from Neon billing."
                    : `Neon consumption request failed (${res.status})`;
            logWarn("[NEON_BILLING] consumption_http_error", { status: res.status, msg });
            return {
                ok: false,
                httpStatus: res.status,
                message: msg,
                aggregated: emptyAgg(),
                rawPreview: parsed as Prisma.InputJsonValue,
            };
        }
        const agg = emptyAgg();
        const projects = (parsed as { projects?: unknown }).projects;
        if (Array.isArray(projects)) {
            for (const p of projects) {
                if (!p || typeof p !== "object") continue;
                const pid = String((p as { project_id?: unknown }).project_id ?? "").trim();
                if (pid !== projectId) continue;
                const periods = (p as { periods?: unknown }).periods;
                if (!Array.isArray(periods)) continue;
                for (const period of periods) {
                    if (!period || typeof period !== "object") continue;
                    const consumption = (period as { consumption?: unknown }).consumption;
                    if (!Array.isArray(consumption)) continue;
                    for (const bucket of consumption) {
                        if (!bucket || typeof bucket !== "object") continue;
                        const metrics = (bucket as { metrics?: unknown }).metrics;
                        if (!Array.isArray(metrics)) continue;
                        for (const row of metrics) {
                            if (!row || typeof row !== "object") continue;
                            const name = String((row as { metric_name?: unknown }).metric_name ?? "").trim();
                            const value = Number((row as { value?: unknown }).value);
                            if (name) mergeMetric(agg, name, value);
                        }
                    }
                }
            }
        }
        logInfo("[NEON_BILLING] consumption_ok", {
            projectId,
            aggregated: agg,
        });
        return {
            ok: true,
            httpStatus: res.status,
            message: "Neon consumption metrics synced (USD total not provided by API — use manual override for invoice MTD).",
            aggregated: agg,
            rawPreview: parsed as Prisma.InputJsonValue,
        };
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logWarn("[NEON_BILLING] consumption_transport_error", { message: msg });
        return {
            ok: false,
            httpStatus: 0,
            message: msg,
            aggregated: emptyAgg(),
            rawPreview: undefined,
        };
    }
}

export async function buildNeonVendorSyncResult(
    monthStart: Date,
    monthEndExclusive: Date,
    internalAggregate: {
        status: string;
        totalCost: number;
        currency: "USD";
        metrics: Record<string, number>;
        diagnostics: Record<string, unknown>;
    },
): Promise<VendorSyncResult & { source: "vendor_api" | "estimated"; billingPeriodStart: Date; billingPeriodEnd: Date; errorMessage?: string | null }> {
    const consumption = await fetchNeonProjectConsumptionMtd(monthStart, monthEndExclusive);
    const rawUsageJson: Record<string, unknown> = {
        neonConsumption: {
            ok: consumption.ok,
            httpStatus: consumption.httpStatus,
            message: consumption.message,
            aggregated: consumption.aggregated,
        },
        internalUsageEventEstimate: {
            status: internalAggregate.status,
            metrics: internalAggregate.metrics,
            diagnostics: internalAggregate.diagnostics,
            estimatedTotalUsd: internalAggregate.totalCost,
        },
    };
    if (consumption.rawPreview)
        rawUsageJson.neonConsumptionRaw = consumption.rawPreview;

    const billingPeriodStart = monthStart;
    const billingPeriodEnd = new Date(monthEndExclusive.getTime() - 1);

    if (!consumption.ok && !String(env.NEON_API_KEY || "").trim()) {
        return {
            provider: "neon",
            status: "missing_token" as VendorSyncStatus,
            totalCost: null,
            currency: "USD",
            rawUsageJson: rawUsageJson as Prisma.InputJsonValue,
            message: consumption.message,
            syncedAt: new Date(),
            source: "estimated",
            billingPeriodStart,
            billingPeriodEnd,
            errorMessage: null,
        };
    }

    if (!consumption.ok) {
        return {
            provider: "neon",
            status: "sync_failed" as VendorSyncStatus,
            totalCost: null,
            currency: "USD",
            rawUsageJson: rawUsageJson as Prisma.InputJsonValue,
            message: consumption.message,
            syncedAt: new Date(),
            source: consumption.httpStatus === 403 ? "vendor_api" : "estimated",
            billingPeriodStart,
            billingPeriodEnd,
            errorMessage: consumption.message,
        };
    }

    return {
        provider: "neon",
        status: "estimated_only" as VendorSyncStatus,
        totalCost: null,
        currency: "USD",
        rawUsageJson: rawUsageJson as Prisma.InputJsonValue,
        message: consumption.message,
        syncedAt: new Date(),
        source: "vendor_api",
        billingPeriodStart,
        billingPeriodEnd,
        errorMessage: null,
    };
}
