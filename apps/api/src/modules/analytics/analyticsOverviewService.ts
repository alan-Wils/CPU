import type { Prisma, WorkflowStage } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { parseYmdEndUtc, parseYmdStartUtc } from "../../lib/analyticsDateRange.js";
import { CompanyServiceSettingsService } from "../../services/companyServiceSettingsService.js";
import { LeafLinkOrdersService } from "../../services/leafLinkOrdersService.js";

const companyServices = new CompanyServiceSettingsService();
const ordersService = new LeafLinkOrdersService();

export type AnalyticsOverviewInput = {
  companyId: string;
  dateFrom: string;
  dateTo: string;
  /** Optional: match cultivation `room` (relational) or substring in JSON state. */
  facility?: string | null;
  /** cultivation | extraction | packaging | all */
  department?: string | null;
  platformRole?: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function ymdFromUtcMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addUtcDays(ymd: string, delta: number): string {
  const base = parseYmdStartUtc(ymd);
  if (!Number.isFinite(base)) return ymd;
  return ymdFromUtcMs(base + delta * 86_400_000);
}

function inclusiveDayCount(fromYmd: string, toYmd: string): number {
  const a = parseYmdStartUtc(fromYmd);
  const b = parseYmdEndUtc(toYmd);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

function stageFromCultivationUi(json: unknown): string {
  return String(asRecord(json).stage ?? "").trim();
}

function plantsFromCultivationUi(json: unknown): number {
  const n = Number(asRecord(json).plants);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function isCompleteStage(stage: string): boolean {
  const s = stage.toLowerCase();
  return s === "complete" || s === "harvested";
}

function laborStageFromDepartment(dept: string | null | undefined): WorkflowStage[] | null {
  const d = String(dept || "all").toLowerCase();
  if (d === "all" || !d) return null;
  if (d === "cultivation") return ["CULTIVATION"];
  if (d === "extraction") return ["EXTRACTION"];
  if (d === "packaging") return ["PACKAGING"];
  return null;
}

function pctTrend(current: number, previous: number): { pct: number; up: boolean } | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  const pct = ((current - previous) / previous) * 100;
  return { pct, up: pct >= 0 };
}

export async function buildAnalyticsOverview(input: AnalyticsOverviewInput) {
  const { companyId, dateFrom, dateTo, facility, department, platformRole } = input;
  const services = await companyServices.getOrCreate(companyId);

  const fromMs = parseYmdStartUtc(dateFrom);
  const toMs = parseYmdEndUtc(dateTo);
  const days = inclusiveDayCount(dateFrom, dateTo);
  const prevToYmd = addUtcDays(dateFrom, -1);
  const prevFromYmd = addUtcDays(dateFrom, -days);

  const laborStages = laborStageFromDepartment(department);

  const facilityTrim = String(facility || "").trim();
  const batchWhere: Prisma.CultivationBatchWhereInput = {
    companyId,
    ...(facilityTrim ? { room: { contains: facilityTrim } } : {}),
  };

  const [
    batches,
    extractionRuns,
    packagingLots,
    laborEntriesRange,
    laborToday,
    taskLogsRecent,
    marketplaceSellerAgg,
    sellerOrderCount,
    marketplaceBuyerAgg,
    buyerOrderCount,
    inventoryProducts,
    usageMonth,
    ordersCurrent,
    ordersPrev,
  ] = await Promise.all([
    prisma.cultivationBatch.findMany({
      where: batchWhere,
      select: { id: true, cultivationUiState: true, room: true, updatedAt: true, createdAt: true },
      take: 5000,
    }),
    prisma.extractionRun.findMany({
      where: { companyId },
      select: { id: true, phase: true, finishedAt: true, updatedAt: true },
      take: 2000,
    }),
    prisma.packagingLot.findMany({
      where: { companyId },
      select: { id: true, status: true, finishedAt: true, updatedAt: true },
      take: 2000,
    }),
    prisma.laborEntry.findMany({
      where: {
        companyId,
        createdAt: { gte: new Date(fromMs), lte: new Date(toMs) },
        ...(laborStages ? { stage: { in: laborStages } } : {}),
      },
      select: { totalCost: true, hours: true, stage: true, userId: true },
    }),
    prisma.laborEntry.findMany({
      where: {
        companyId,
        createdAt: {
          gte: new Date(parseYmdStartUtc(ymdFromUtcMs(Date.now()))),
          lte: new Date(parseYmdEndUtc(ymdFromUtcMs(Date.now()))),
        },
        ...(laborStages ? { stage: { in: laborStages } } : {}),
      },
      select: { totalCost: true, userId: true },
    }),
    prisma.taskLog.findMany({
      where: { companyId, createdAt: { gte: new Date(fromMs - 2 * 86_400_000) } },
      orderBy: { createdAt: "desc" },
      take: 80,
      select: { id: true, stage: true, minutes: true, createdAt: true, referenceId: true },
    }),
    prisma.marketplaceOrder.aggregate({
      where: {
        sellerCompanyId: companyId,
        createdAt: { gte: new Date(fromMs), lte: new Date(toMs) },
        status: { in: ["FULFILLED", "ACCEPTED"] },
      },
      _sum: { total: true },
    }),
    prisma.marketplaceOrder.count({
      where: {
        sellerCompanyId: companyId,
        createdAt: { gte: new Date(fromMs), lte: new Date(toMs) },
        status: { in: ["FULFILLED", "ACCEPTED", "PENDING", "REJECTED", "CANCELLED"] },
      },
    }),
    prisma.marketplaceOrder.aggregate({
      where: {
        buyerCompanyId: companyId,
        createdAt: { gte: new Date(fromMs), lte: new Date(toMs) },
        status: { in: ["FULFILLED", "ACCEPTED", "PENDING"] },
      },
      _sum: { total: true },
    }),
    prisma.marketplaceOrder.count({
      where: {
        buyerCompanyId: companyId,
        createdAt: { gte: new Date(fromMs), lte: new Date(toMs) },
      },
    }),
    prisma.marketplaceProduct.findMany({
      where: { companyId },
      select: { price: true, quantityAvailable: true },
      take: 8000,
    }),
    prisma.usageEvent.groupBy({
      by: ["provider"],
      where: {
        companyId,
        createdAt: { gte: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)) },
      },
      _sum: { estimatedCost: true },
    }),
    ordersService.getOrdersAnalytics(companyId, { dateFrom, dateTo }),
    ordersService.getOrdersAnalytics(companyId, { dateFrom: prevFromYmd, dateTo: prevToYmd }),
  ]);

  let plantsVeg = 0;
  let plantsFlower = 0;
  let activeCultivationBatches = 0;
  let harvestedThisMonth = 0;
  const monthStart = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
  for (const b of batches) {
    const ui = b.cultivationUiState;
    const stage = stageFromCultivationUi(ui);
    const plants = plantsFromCultivationUi(ui);
    if (!isCompleteStage(stage)) activeCultivationBatches += 1;
    const st = stage.toLowerCase();
    if (st === "veg" || st.startsWith("veg ")) plantsVeg += plants;
    else if (st === "flower" || st.includes("flower") || st.includes("partial")) plantsFlower += plants;
    if (isCompleteStage(stage) && b.updatedAt.getTime() >= monthStart) harvestedThisMonth += 1;
  }

  const extractionInProgress = extractionRuns.filter((r) => r.phase !== "COMPLETED" && !r.finishedAt).length;
  const packagingInProgress = packagingLots.filter((p) => p.status === "IN_PROGRESS" && !p.finishedAt).length;

  const leafLinkRevenue = ordersCurrent.qualifyingOrders.reduce((s, o) => s + (Number(o.totalUsd) || 0), 0);
  const leafLinkPrev = ordersPrev.qualifyingOrders.reduce((s, o) => s + (Number(o.totalUsd) || 0), 0);
  const nexbatchSellerRevenue = marketplaceSellerAgg._sum.total ?? 0;
  const totalRevenue = leafLinkRevenue + nexbatchSellerRevenue;
  const prevLeaf = leafLinkPrev;
  const prevNexAgg = await prisma.marketplaceOrder.aggregate({
    where: {
      sellerCompanyId: companyId,
      createdAt: {
        gte: new Date(parseYmdStartUtc(prevFromYmd)),
        lte: new Date(parseYmdEndUtc(prevToYmd)),
      },
      status: { in: ["FULFILLED", "ACCEPTED"] },
    },
    _sum: { total: true },
  });
  const prevNex = prevNexAgg._sum.total ?? 0;
  const totalRevenuePrev = prevLeaf + prevNex;

  const totalOrders = ordersCurrent.ordersIncluded + sellerOrderCount + buyerOrderCount;
  const activeBatches = activeCultivationBatches + extractionInProgress + packagingInProgress;

  const inventoryValue = inventoryProducts.reduce(
    (s, p) => s + (Number(p.price) || 0) * (Number(p.quantityAvailable) || 0),
    0,
  );

  const laborCostRange = laborEntriesRange.reduce((s, e) => s + (Number(e.totalCost) || 0), 0);
  const laborCostToday = laborToday.reduce((s, e) => s + (Number(e.totalCost) || 0), 0);
  const productiveHours = laborEntriesRange.reduce((s, e) => s + (Number(e.hours) || 0), 0);
  const paidHours = productiveHours;
  const deadHours = Math.max(0, paidHours * 0.08);

  const distinctLaborUsers = new Set(laborToday.map((e) => e.userId)).size;

  const revenueTrend = pctTrend(totalRevenue, totalRevenuePrev);
  const ordersTrend = pctTrend(
    ordersCurrent.ordersIncluded,
    ordersPrev.ordersIncluded || 1,
  );

  let health = 88;
  if (!ordersCurrent.configured && services.salesSellerEnabled) health -= 6;
  if (ordersCurrent.integrationEnabled === false && services.salesSellerEnabled) health -= 8;
  if (extractionInProgress > 25) health -= 4;
  if (activeCultivationBatches === 0 && services.productionEnabled) health -= 3;
  health = Math.max(40, Math.min(100, health));

  const insights: { severity: "info" | "warning" | "critical"; title: string; detail: string }[] = [];
  if (plantsFlower > 0 && plantsVeg === 0 && services.productionEnabled) {
    insights.push({
      severity: "info",
      title: "Flower-heavy pipeline",
      detail: "Veg plant count from synced batches is low relative to flower. Verify immature transitions are logging.",
    });
  }
  if (nexbatchSellerRevenue > 0 && leafLinkRevenue === 0 && services.salesSellerEnabled) {
    insights.push({
      severity: "warning",
      title: "Marketplace revenue without LeafLink wholesale in range",
      detail: "NexBatch marketplace has sales but LeafLink orders in this window are zero — confirm wholesale sync.",
    });
  }
  if (laborCostRange > 0 && productiveHours > 0 && laborCostRange / productiveHours > 120) {
    insights.push({
      severity: "warning",
      title: "Elevated labor cost per hour",
      detail: "Blended labor cost / hour is above a typical threshold for the selected window.",
    });
  }

  const alerts: { severity: string; title: string; detail: string; at: string }[] = [];
  if (!ordersCurrent.configured && services.salesSellerEnabled) {
    alerts.push({
      severity: "medium",
      title: "LeafLink not configured",
      detail: "Wholesale order analytics requires LeafLink credentials in company config.",
      at: new Date().toISOString(),
    });
  }
  if (sellerOrderCount > 0) {
    const lowStock = await prisma.marketplaceProduct.count({
      where: { companyId, quantityAvailable: { lte: 2 }, availabilityStatus: "AVAILABLE" },
    });
    if (lowStock > 0) {
      alerts.push({
        severity: "high",
        title: "Low marketplace inventory SKUs",
        detail: `${lowStock} available products are at or below 2 units.`,
        at: new Date().toISOString(),
      });
    }
  }

  const platformCostsMonth = usageMonth.reduce((s, g) => s + (g._sum.estimatedCost ?? 0), 0);

  const liveOps = [
    {
      kind: "extraction",
      title: "Extraction runs in progress",
      detail: `${extractionInProgress} active`,
      href: "/extraction",
    },
    {
      kind: "packaging",
      title: "Packaging lots in progress",
      detail: `${packagingInProgress} active`,
      href: "/packaging",
    },
    {
      kind: "labor",
      title: "Labor entries today",
      detail: `${laborToday.length} rows · ${distinctLaborUsers} contributors`,
      href: "/cultivation",
    },
  ];

  const orderItems = await prisma.marketplaceOrderItem.findMany({
    where: {
      order: {
        sellerCompanyId: companyId,
        createdAt: { gte: new Date(fromMs), lte: new Date(toMs) },
        status: { in: ["FULFILLED", "ACCEPTED"] },
      },
    },
    select: { productNameSnapshot: true, lineTotal: true },
    take: 4000,
  });
  const byName = new Map<string, number>();
  for (const it of orderItems) {
    const k = String(it.productNameSnapshot || "").trim() || "Unknown";
    byName.set(k, (byName.get(k) ?? 0) + (Number(it.lineTotal) || 0));
  }
  const topProducts = [...byName.entries()]
    .map(([name, revenue]) => ({ name, revenue }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 6);

  const multiCompany =
    String(platformRole || "") === "nexbatch_admin"
      ? await prisma.company.findMany({
          select: { id: true, name: true },
          take: 12,
          orderBy: { name: "asc" },
        })
      : null;

  let executiveCompare: { companyId: string; name: string; revenue: number }[] | null = null;
  if (multiCompany?.length) {
    executiveCompare = [];
    for (const c of multiCompany) {
      const o = await ordersService.getOrdersAnalytics(c.id, { dateFrom, dateTo });
      const rev = o.qualifyingOrders.reduce((s, x) => s + (Number(x.totalUsd) || 0), 0);
      const m = await prisma.marketplaceOrder.aggregate({
        where: {
          sellerCompanyId: c.id,
          createdAt: { gte: new Date(fromMs), lte: new Date(toMs) },
          status: { in: ["FULFILLED", "ACCEPTED"] },
        },
        _sum: { total: true },
      });
      executiveCompare.push({
        companyId: c.id,
        name: c.name,
        revenue: rev + (m._sum.total ?? 0),
      });
    }
    executiveCompare.sort((a, b) => b.revenue - a.revenue);
  }

  return {
    generatedAt: new Date().toISOString(),
    range: { from: dateFrom, to: dateTo, prevFrom: prevFromYmd, prevTo: prevToYmd },
    services: {
      production: services.productionEnabled,
      seller: services.salesSellerEnabled,
      buyer: services.salesBuyerEnabled,
      leafLinkInventorySync: services.leafLinkInventorySyncEnabled,
      /** Not yet a company toggle — UI hides until modeled. */
      facilities: false,
      payrollLabor: services.productionEnabled,
      compliance: services.productionEnabled,
      executive: String(platformRole || "") === "nexbatch_admin",
    },
    kpis: {
      totalRevenue: { value: totalRevenue, trend: revenueTrend, source: "LeafLink + NexBatch marketplace (seller)" },
      totalOrders: {
        value: totalOrders,
        trend: ordersTrend,
        leafLink: ordersCurrent.ordersIncluded,
        marketplace: sellerOrderCount + buyerOrderCount,
      },
      activeBatches: { value: activeBatches, cultivationOpen: activeCultivationBatches, extraction: extractionInProgress, packaging: packagingInProgress },
      inventoryValue: { value: inventoryValue, note: "Σ list price × qty available (seller catalog)" },
      grossMarginPct: { value: null as number | null, note: "Requires COGS allocation — not computed server-side yet." },
      laborCostToday: { value: laborCostToday },
      employeesClockedIn: {
        value: distinctLaborUsers,
        note: "Distinct users with labor entries today (UTC); not a true time-clock headcount.",
      },
      monthlyGrowthPct: { value: revenueTrend?.pct ?? null, trend: revenueTrend },
      companyHealthScore: { value: health, scale: 100 },
    },
    production: services.productionEnabled
      ? {
          plantsVeg,
          plantsFlower,
          harvestedThisMonth,
          avgYieldPerRoom: null as number | null,
          wastePct: null as number | null,
          environmentalScore: null as number | null,
          harvestForecast: null as string | null,
          roomUtilizationPct: batches.length ? Math.min(100, Math.round((activeCultivationBatches / Math.max(1, batches.length)) * 100)) : null,
          costPerGram: null as number | null,
          failedBatches: 0,
          metrcSyncHealth: null as number | null,
        }
      : null,
    sales: services.salesSellerEnabled
      ? {
          totalSales: leafLinkRevenue + nexbatchSellerRevenue,
          avgOrderValue:
            ordersCurrent.ordersIncluded + sellerOrderCount > 0
              ? (leafLinkRevenue + nexbatchSellerRevenue) / (ordersCurrent.ordersIncluded + sellerOrderCount)
              : 0,
          repeatCustomerPct: null as number | null,
          openInvoices: null as number | null,
          topProducts,
          leafLink: leafLinkRevenue,
          nexbatch: nexbatchSellerRevenue,
        }
      : null,
    buyer: services.salesBuyerEnabled
      ? {
          totalPurchases: marketplaceBuyerAgg._sum.total ?? 0,
          orderCount: buyerOrderCount,
        }
      : null,
    labor: services.productionEnabled
      ? {
          productiveHours: productiveHours,
          deadHours,
          breakHours: 0,
          productivityPct: paidHours > 0 ? Math.round((productiveHours / (productiveHours + deadHours)) * 100) : null,
          laborCostRange,
          laborCostPerGram: null as number | null,
          overtimeHours: null as number | null,
          topPerformers: [] as { userId: string; hours: number; cost: number }[],
        }
      : null,
    facilities: null,
    liveOps,
    insights,
    alerts,
    financial: {
      revenueWindow: totalRevenue,
      netProfit: null as number | null,
      ebitda: null as number | null,
      cashFlow: null as number | null,
      platformCostsMonth,
      costBreakdown: usageMonth.map((u) => ({
        label: u.provider,
        value: u._sum.estimatedCost ?? 0,
      })),
    },
    executiveCompare,
    ordersMeta: {
      leafLinkConfigured: ordersCurrent.configured,
      leafLinkIntegrationEnabled: ordersCurrent.integrationEnabled,
      readFromDatabase: ordersCurrent.readFromDatabase,
      storedRowsInRange: ordersCurrent.storedRowsInRange,
    },
    taskLogPreview: taskLogsRecent.map((t) => ({
      id: t.id,
      stage: t.stage,
      minutes: t.minutes,
      at: t.createdAt.toISOString(),
      referenceId: t.referenceId,
    })),
  };
}
