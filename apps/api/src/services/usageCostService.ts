import type { UsageProvider } from "@prisma/client";
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
    status: "connected" | "missing_token" | "sync_failed" | "unsupported" | "estimated_only";
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
        notes: "Bandwidth and build minutes from app-estimated events (no Vercel API yet).",
    },
    railway: {
        displayName: "Railway Backend",
        notes: "API/worker utilization estimated from logged events.",
    },
    neon: {
        displayName: "Neon Database",
        notes: "Rows written / queries approximated from DB-touching actions.",
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
                (snapshotStatus === "connected" || snapshotStatus === "unsupported") &&
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

            const usageSummary = estimatedCost > 0
                ? `${usageMetrics.map((m) => `${m.label}: ${m.value}`).join(" · ")} · Event est. ${formatUsd(estimatedCost)}`
                : "No usage logged this month for this provider.";

            let statusLabel = "Estimated from app usage only";
            if (snapshotStatus === "connected")
                statusLabel = "Live vendor synced";
            else if (snapshotStatus === "missing_token")
                statusLabel = "Missing token";
            else if (snapshotStatus === "sync_failed")
                statusLabel = "Sync failed";
            else if (snapshotStatus === "unsupported")
                statusLabel = "Connected, billing endpoint unsupported";
            if (meta.exactInternalPreferred && estimatedCost > 0) {
                statusLabel = "Estimated from app usage (exact internal events)";
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
                status: snapshotStatus,
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
