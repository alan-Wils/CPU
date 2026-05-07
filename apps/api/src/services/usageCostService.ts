import type { UsageProvider } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";

export type UsageCostMetric = { label: string; value: string };

export type UsageCostProviderRow = {
    provider: UsageProvider;
    displayName: string;
    usageSummary: string;
    usageMetrics: UsageCostMetric[];
    estimatedCost: number;
    currency: "USD";
    status: string;
    notes: string;
};

export type CompanyUsageCostsResult = {
    companyId: string;
    companyName: string;
    monthLabel: string;
    monthStart: string;
    monthEnd: string;
    totalEstimatedCost: number;
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
    { displayName: string; notes: string }
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
        notes: "Outbound mail attempts logged after transport success.",
    },
    cloudflare_r2: {
        displayName: "Cloudflare R2 Storage",
        notes: "Uploads when S3-compatible storage is enabled.",
    },
    ai: {
        displayName: "AI Data Analysis",
        notes: "OpenAI calls for naming, harvest extraction, etc.",
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

        const events = await prisma.usageEvent.findMany({
            where: {
                companyId: id,
                createdAt: {
                    gte: monthStart,
                    lt: nextMonthStart,
                },
            },
            orderBy: { createdAt: "asc" },
        });

        let totalEstimatedCost = 0;
        let lastUpdated: Date | null = null;

        type Agg = {
            cost: number;
            byUnit: Map<string, number>;
            maxCreated: Date | null;
        };
        const agg = new Map<UsageProvider, Agg>();

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

            const usageSummary =
                estimatedCost > 0
                    ? `${usageMetrics.map((m) => `${m.label}: ${m.value}`).join(" · ")} · Est. ${formatUsd(estimatedCost)}`
                    : "No usage logged this month for this provider.";

            let status = "No activity";
            if (a?.maxCreated) {
                const ageH = (now.getTime() - a.maxCreated.getTime()) / (60 * 60 * 1000);
                status = ageH < 48 ? "Recent activity" : "Stale — last event > 48h ago";
            }

            return {
                provider,
                displayName: meta.displayName,
                usageSummary,
                usageMetrics,
                estimatedCost,
                currency: "USD" as const,
                status,
                notes: meta.notes,
            };
        });

        const monthEnd = new Date(nextMonthStart.getTime() - 1);

        return {
            companyId: company.id,
            companyName: company.name,
            monthLabel: label,
            monthStart: monthStart.toISOString(),
            monthEnd: monthEnd.toISOString(),
            totalEstimatedCost,
            projectedMonthlyCost,
            lastUpdated: lastUpdated ? lastUpdated.toISOString() : null,
            providers,
        };
    }
}
