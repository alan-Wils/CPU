import type { UsageProvider } from "@prisma/client";
import { estimateStorageMbFromRowsWritten } from "../config/neonUsagePricing.js";
import { prisma } from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";

export type UsageCostMetric = { label: string; value: string };

export type UsageCostProviderRow = {
    provider: UsageProvider;
    displayName: string;
    usageSummary: string;
    usageMetrics: UsageCostMetric[];
    displayCost: number;
    estimatedCost: number;
    vendorTotalCost: number | null;
    currency: "USD";
    status: "live_synced" | "missing_token" | "sync_failed" | "estimated_only" | "no_activity";
    statusLabel: string;
    allocationMethod: "exact_internal" | "vendor_allocated" | "estimated";
    lastSyncedAt: string | null;
    notes: string;
};

export type CompanyUsageCostsResult = {
    companyId: string;
    companyName: string;
    monthLabel: string;
    monthStart: string;
    monthEnd: string;
    totalEstimatedCost: number;
    totalDisplayCost: number;
    projectedMonthlyCost: number | null;
    lastUpdated: string | null;
    providers: UsageCostProviderRow[];
};

const PROVIDER_ORDER: UsageProvider[] = [
    "vercel",
    "railway",
    "neon",
    "resend",
    "cloudflare_r2",
    "ai",
];

const PROVIDER_META: Record<
    UsageProvider,
    { displayName: string; notes: string; exactInternalPreferred?: boolean }
> = {
    vercel: {
        displayName: "Vercel Frontend",
        notes: "Frontend usage allocation from app usage events with vendor sync status.",
    },
    railway: {
        displayName: "Railway Backend",
        notes: "API/worker utilization estimated from logged events.",
    },
    neon: {
        displayName: "Neon Database",
        notes: "Tenant usage is aggregated internally from UsageEvent activity (Neon API optional for diagnostics).",
    },
    resend: {
        displayName: "Resend Email",
        notes: "Vendor totals are project-level; company amount uses exact email events when present.",
        exactInternalPreferred: true,
    },
    cloudflare_r2: {
        displayName: "Cloudflare R2 Storage",
        notes: "Vendor totals are project-level; company amount uses exact storage events when present.",
        exactInternalPreferred: true,
    },
    ai: {
        displayName: "AI Data Analysis",
        notes: "Vendor totals are project-level; company amount uses exact token/call events when present.",
        exactInternalPreferred: true,
    },
};

function utcMonthRange(now: Date): { monthStart: Date; nextMonthStart: Date; label: string } {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const monthStart = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
    const nextMonthStart = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0));
    const label = `${y}-${String(m + 1).padStart(2, "0")}`;
    return { monthStart, nextMonthStart, label };
}

function formatUsd(n: number): string {
    if (!Number.isFinite(n))
        return "$0.00";
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(n);
}

function formatUnits(n: number): string {
    if (!Number.isFinite(n))
        return "0";
    if (Math.abs(n - Math.round(n)) < 1e-9)
        return String(Math.round(n));
    return n.toFixed(2);
}

export class UsageCostService {
    async getCompanyUsageCosts(companyId: string): Promise<CompanyUsageCostsResult> {
        const id = String(companyId || "").trim();
        if (!id) {
            throw new AppError("Missing company id", 400);
        }

        const company = await prisma.company.findUnique({
            where: { id },
            select: { id: true, name: true },
        });
        if (!company) {
            throw new AppError("Company not found", 404);
        }

        const now = new Date();
        const { monthStart, nextMonthStart, label } = utcMonthRange(now);
        const [events, allProviderAgg, snapshots] = await Promise.all([
            prisma.usageEvent.findMany({
                where: {
                    companyId: id,
                    createdAt: {
                        gte: monthStart,
                        lt: nextMonthStart,
                    },
                },
                orderBy: { createdAt: "asc" },
            }),
            prisma.usageEvent.groupBy({
                by: ["provider"],
                where: {
                    createdAt: {
                        gte: monthStart,
                        lt: nextMonthStart,
                    },
                },
                _sum: { estimatedCost: true, units: true },
            }),
            prisma.vendorBillingSnapshot.findMany({
                where: { month: label },
            }),
        ]);

        let totalEstimatedCost = 0;
        let lastUpdated: Date | null = null;

        type Agg = {
            cost: number;
            byUnit: Map<string, number>;
            maxCreated: Date | null;
        };
        const agg = new Map<UsageProvider, Agg>();
        const globalAgg = new Map<UsageProvider, { estimatedCost: number; units: number }>();
        const snapshotByProvider = new Map(snapshots.map((s) => [s.provider, s]));

        for (const row of allProviderAgg) {
            globalAgg.set(row.provider, {
                estimatedCost: row._sum.estimatedCost ?? 0,
                units: row._sum.units ?? 0,
            });
        }

        for (const e of events) {
            totalEstimatedCost += e.estimatedCost;
            const t = e.createdAt;
            if (!lastUpdated || t > lastUpdated)
                lastUpdated = t;

            let a = agg.get(e.provider);
            if (!a) {
                a = { cost: 0, byUnit: new Map(), maxCreated: null };
                agg.set(e.provider, a);
            }
            a.cost += e.estimatedCost;
            const prev = a.byUnit.get(e.unitType) ?? 0;
            a.byUnit.set(e.unitType, prev + e.units);
            if (!a.maxCreated || t > a.maxCreated)
                a.maxCreated = t;
        }

        const daysInMonth =
            (nextMonthStart.getTime() - monthStart.getTime()) / (24 * 60 * 60 * 1000);
        const elapsedMs = Math.max(0, now.getTime() - monthStart.getTime());
        const elapsedDays = Math.max(1, elapsedMs / (24 * 60 * 60 * 1000));

        let projectedMonthlyCost: number | null = null;
        if (events.length > 0 && elapsedDays >= 2) {
            projectedMonthlyCost = (totalEstimatedCost / elapsedDays) * daysInMonth;
        }

        const providers: UsageCostProviderRow[] = PROVIDER_ORDER.map((provider) => {
            const meta = PROVIDER_META[provider];
            const a = agg.get(provider);
            const estimatedCost = a?.cost ?? 0;
            const global = globalAgg.get(provider) ?? { estimatedCost: 0, units: 0 };
            const snapshot = snapshotByProvider.get(provider);
            const snapshotStatus =
                (snapshot?.status as UsageCostProviderRow["status"] | undefined) ??
                "estimated_only";
            const vendorTotalCost =
                snapshot &&
                snapshotStatus === "live_synced" &&
                Number.isFinite(snapshot.totalCost)
                    ? snapshot.totalCost
                    : null;
            let displayCost = estimatedCost;
            let allocationMethod: UsageCostProviderRow["allocationMethod"] = "estimated";

            // Vendor APIs return project-level totals only; allocate by provider share from UsageEvent rows.
            const totalWeight =
                global.estimatedCost > 0 ? global.estimatedCost : Math.max(0, global.units);
            const companyWeight =
                estimatedCost > 0
                    ? estimatedCost
                    : Math.max(0, Array.from(a?.byUnit.values() ?? []).reduce((s, n) => s + n, 0));

            if (meta.exactInternalPreferred && estimatedCost > 0) {
                displayCost = estimatedCost;
                allocationMethod = "exact_internal";
            }
            else if (vendorTotalCost != null && totalWeight > 0) {
                displayCost = vendorTotalCost * (companyWeight / totalWeight);
                allocationMethod = "vendor_allocated";
            }

            const usageMetrics: UsageCostMetric[] = [];
            if (a && a.byUnit.size > 0) {
                for (const [unitType, units] of a.byUnit.entries()) {
                    usageMetrics.push({
                        label: unitType.replace(/_/g, " "),
                        value: formatUnits(units),
                    });
                }
            }
            else {
                usageMetrics.push({ label: "Logged units (MTD)", value: "0" });
            }

            const hasCompanyActivity = estimatedCost > 0 || (a?.byUnit.size ?? 0) > 0;
            const hasResendUnitEvents = provider === "resend" && (a?.byUnit.size ?? 0) > 0;

            let usageSummary =
                estimatedCost > 0 || hasResendUnitEvents
                    ? `${usageMetrics.map((m) => `${m.label}: ${m.value}`).join(
                        " · ",
                    )} · Event est. ${formatUsd(provider === "resend" ? displayCost : estimatedCost)}`
                    : "No usage logged this month for this provider.";

            let effectiveStatus: UsageCostProviderRow["status"] = snapshotStatus;
            if (!hasCompanyActivity && (snapshotStatus === "estimated_only" || !snapshot)) {
                effectiveStatus = "no_activity";
            }

            /** Resend: tenant attribution is UsageEvent-backed; unhealthy vendor probes should not eclipse internal activity */
            const resendSnapshotDown =
                snapshotStatus === "sync_failed" || snapshotStatus === "missing_token";
            if (provider === "resend" && hasCompanyActivity && resendSnapshotDown) {
                effectiveStatus = "estimated_only";
            }

            let statusLabel = "Estimated from app usage only";
            if (effectiveStatus === "live_synced")
                statusLabel = "Live vendor synced";
            else if (effectiveStatus === "missing_token")
                statusLabel = "Missing token";
            else if (effectiveStatus === "sync_failed")
                statusLabel = "Sync failed";
            else if (effectiveStatus === "no_activity")
                statusLabel = "No activity";
            if (meta.exactInternalPreferred && estimatedCost > 0) {
                statusLabel = "Estimated from app usage (exact internal events)";
            }
            if (provider === "resend" && hasCompanyActivity && resendSnapshotDown) {
                statusLabel =
                    snapshotStatus === "missing_token"
                        ? "Estimated from internal email events (RESEND_API_KEY missing — vendor diagnostics only)"
                        : "Estimated from internal email events (Resend probe failed — check API key)";
            }
            if (provider === "neon") {
                const raw = (snapshot?.rawUsageJson ?? null) as {
                    neonStatus?: string;
                    metrics?: Record<string, unknown>;
                } | null;
                const neonStatus = String(raw?.neonStatus || "").trim();
                /**
                 * Snapshot `raw.metrics` is project-wide (all tenants on one Postgres).
                 * This endpoint is company-scoped: only surface UsageEvent totals for `companyId`.
                 */
                const tenantUnit = (key: string) =>
                    Number(a?.byUnit.get(key) ?? 0);
                const dbReads = tenantUnit("db_read");
                const dbWrites = tenantUnit("db_write");
                const rowsWritten = tenantUnit("rows_written");
                const rowsRead = tenantUnit("rows_read");
                const queries = tenantUnit("query");
                let storageMb = tenantUnit("storage_mb");
                if (storageMb <= 0 && rowsWritten > 0)
                    storageMb = estimateStorageMbFromRowsWritten(rowsWritten);
                usageMetrics.splice(0, usageMetrics.length, ...[
                    { label: "db reads", value: formatUnits(dbReads) },
                    { label: "db writes", value: formatUnits(dbWrites) },
                    { label: "rows written", value: formatUnits(rowsWritten) },
                    { label: "rows read", value: formatUnits(rowsRead) },
                    { label: "query", value: formatUnits(queries) },
                    { label: "storage mb", value: formatUnits(storageMb) },
                ]);
                usageSummary =
                    `${usageMetrics.map((x) => `${x.label}: ${x.value}`).join(" · ")} · Est. ${formatUsd(displayCost)}`;
                if (!neonStatus) {
                    if (effectiveStatus === "sync_failed")
                        statusLabel = "Error";
                    else if (effectiveStatus === "missing_token")
                        statusLabel = "Missing config";
                    else if (effectiveStatus === "no_activity")
                        statusLabel = "No activity";
                    else
                        statusLabel = "Aggregated internally";
                }
                else if (neonStatus === "Active")
                    statusLabel = "Active";
                else if (neonStatus === "No activity")
                    statusLabel = "No activity";
                else if (neonStatus === "Aggregated internally")
                    statusLabel = "Aggregated internally";
                else if (neonStatus === "Missing config")
                    statusLabel = "Missing config";
                else if (neonStatus === "Error")
                    statusLabel = "Error";
            }

            return {
                provider,
                displayName: meta.displayName,
                usageSummary,
                usageMetrics,
                displayCost,
                estimatedCost,
                vendorTotalCost,
                currency: "USD" as const,
                status: effectiveStatus,
                statusLabel,
                allocationMethod,
                lastSyncedAt: snapshot?.syncedAt ? snapshot.syncedAt.toISOString() : null,
                notes: meta.notes,
            };
        });

        const monthEnd = new Date(nextMonthStart.getTime() - 1);
        const totalDisplayCost = providers.reduce((sum, row) => sum + (row.displayCost || 0), 0);

        return {
            companyId: company.id,
            companyName: company.name,
            monthLabel: label,
            monthStart: monthStart.toISOString(),
            monthEnd: monthEnd.toISOString(),
            totalEstimatedCost,
            totalDisplayCost,
            projectedMonthlyCost,
            lastUpdated: lastUpdated ? lastUpdated.toISOString() : null,
            providers,
        };
    }
}
