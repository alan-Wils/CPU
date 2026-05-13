import type { Prisma, WorkflowStage } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { parseYmdEndUtc, parseYmdStartUtc } from "../../lib/analyticsDateRange.js";
import { CompanyServiceSettingsService } from "../../services/companyServiceSettingsService.js";
import {
  LeafLinkInventoryService,
  leafLinkInventoryRowsForPageDefaultTotals,
  sumLeafLinkInventoryValueUsd,
  type LeafLinkInventoryItem,
} from "../../services/leaflinkService.js";
import { LeafLinkOrdersService, type OrdersAnalyticsDto } from "../../services/leafLinkOrdersService.js";

const companyServices = new CompanyServiceSettingsService();
const ordersService = new LeafLinkOrdersService();
const leafLinkInventoryService = new LeafLinkInventoryService();

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

/** KPI revenue uses full in-range totals; scatter payload may truncate `qualifyingOrders`. */
function leafLinkQualifyingRevenueUsd(d: OrdersAnalyticsDto): number {
  if (typeof d.qualifyingRevenueTotalUsd === "number" && Number.isFinite(d.qualifyingRevenueTotalUsd)) {
    return d.qualifyingRevenueTotalUsd;
  }
  return d.qualifyingOrders.reduce((s, o) => s + (Number(o.totalUsd) || 0), 0);
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

const GRAMS_PER_LB = 453.59237;

function eachUtcDayYmd(fromYmd: string, toYmd: string, maxDays: number): string[] {
  const out: string[] = [];
  let ms = parseYmdStartUtc(fromYmd);
  const end = parseYmdEndUtc(toYmd);
  let n = 0;
  while (ms <= end && n < maxDays) {
    out.push(ymdFromUtcMs(ms));
    ms += 86_400_000;
    n++;
  }
  return out;
}

function leafLinkUsdByDayFromOrders(qualifyingOrders: { createdAt: string; totalUsd: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const q of qualifyingOrders) {
    const day = String(q.createdAt || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    m.set(day, (m.get(day) ?? 0) + (Number(q.totalUsd) || 0));
  }
  return m;
}

function mpSellerUsdByDay(rows: { createdAt: Date; total: unknown }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const day = ymdFromUtcMs(r.createdAt.getTime());
    const v = Number(r.total) || 0;
    m.set(day, (m.get(day) ?? 0) + v);
  }
  return m;
}

export async function buildAnalyticsOverview(input: AnalyticsOverviewInput) {
  const { companyId, dateFrom, dateTo, facility, department, platformRole } = input;
  const services = await companyServices.getOrCreate(companyId);
  /** When false, analytics excludes NexBatch seller marketplace $ and seller order counts from blended KPIs. */
  const sellerWorkspaceOn = services.salesSellerEnabled;

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
    leafLinkInventoryItems,
    marketplaceSellerOrdersInRange,
    ordersCurrent,
    ordersPrev,
  ] = await Promise.all([
    prisma.cultivationBatch.findMany({
      where: batchWhere,
      select: {
        id: true,
        strain: true,
        strainAcronym: true,
        aGradeFlowerGrams: true,
        popcornGrams: true,
        trimGrams: true,
        cultivationUiState: true,
        room: true,
        updatedAt: true,
        createdAt: true,
      },
      take: 5000,
    }),
    prisma.extractionRun.findMany({
      where: { companyId },
      select: { id: true, phase: true, finishedAt: true, updatedAt: true },
      take: 2000,
    }),
    prisma.packagingLot.findMany({
      where: { companyId },
      select: { id: true, status: true, finishedAt: true, updatedAt: true, sku: true, units: true },
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
    (async (): Promise<LeafLinkInventoryItem[]> => {
      try {
        const inv = await leafLinkInventoryService.fetchAvailableInventory(companyId, {
          refresh: false,
          actorUserId: "system",
        });
        return inv.items;
      } catch {
        return [];
      }
    })(),
    prisma.marketplaceOrder.findMany({
      where: {
        sellerCompanyId: companyId,
        createdAt: { gte: new Date(fromMs), lte: new Date(toMs) },
        status: { in: ["FULFILLED", "ACCEPTED"] },
      },
      select: { createdAt: true, total: true },
      take: 8000,
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

  const leafLinkRevenue = leafLinkQualifyingRevenueUsd(ordersCurrent);
  const leafLinkPrev = leafLinkQualifyingRevenueUsd(ordersPrev);
  const nexbatchSellerRevenue = marketplaceSellerAgg._sum.total ?? 0;
  const nexbatchForTotals = sellerWorkspaceOn ? nexbatchSellerRevenue : 0;
  const totalRevenue = leafLinkRevenue + nexbatchForTotals;
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
  const prevNexForTotals = sellerWorkspaceOn ? prevNex : 0;
  const totalRevenuePrev = prevLeaf + prevNexForTotals;

  const totalOrders =
    ordersCurrent.ordersIncluded + (sellerWorkspaceOn ? sellerOrderCount : 0) + buyerOrderCount;
  const activeBatches = activeCultivationBatches + extractionInProgress + packagingInProgress;

  const inventoryValue = sumLeafLinkInventoryValueUsd(
    leafLinkInventoryRowsForPageDefaultTotals(leafLinkInventoryItems),
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

  const insights: {
    severity: "info" | "warning" | "critical";
    category: string;
    title: string;
    detail: string;
  }[] = [];
  if (plantsFlower > 0 && plantsVeg === 0 && services.productionEnabled) {
    insights.push({
      severity: "info",
      category: "Production",
      title: "Flower-heavy pipeline",
      detail: "Veg plant count from synced batches is low relative to flower. Verify immature transitions are logging.",
    });
  }
  if (nexbatchSellerRevenue > 0 && leafLinkRevenue === 0 && services.salesSellerEnabled) {
    insights.push({
      severity: "warning",
      category: "Sales",
      title: "Marketplace revenue without LeafLink wholesale in range",
      detail: "NexBatch marketplace has sales but LeafLink orders in this window are zero — confirm wholesale sync.",
    });
  }
  if (laborCostRange > 0 && productiveHours > 0 && laborCostRange / productiveHours > 120) {
    insights.push({
      severity: "warning",
      category: "Labor",
      title: "Elevated labor cost per hour",
      detail: "Blended labor cost / hour is above a typical threshold for the selected window.",
    });
  }

  const lowStockSkuCount =
    sellerOrderCount > 0
      ? await prisma.marketplaceProduct.count({
          where: { companyId, quantityAvailable: { lte: 2 }, availabilityStatus: "AVAILABLE" },
        })
      : 0;
  if (lowStockSkuCount > 0 && services.salesSellerEnabled) {
    insights.push({
      severity: "warning",
      category: "Inventory",
      title: "Inventory shortage risk",
      detail: `${lowStockSkuCount} marketplace SKUs are at or below 2 units available.`,
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
  if (lowStockSkuCount > 0) {
    alerts.push({
      severity: "high",
      title: "Low marketplace inventory SKUs",
      detail: `${lowStockSkuCount} available products are at or below 2 units.`,
      at: new Date().toISOString(),
    });
  }

  const llByDay = leafLinkUsdByDayFromOrders(ordersCurrent.qualifyingOrders);
  const mpByDay = mpSellerUsdByDay(marketplaceSellerOrdersInRange);
  const chartDays = eachUtcDayYmd(dateFrom, dateTo, 120);
  const salesOverTime = chartDays.map((d) => {
    const ll = llByDay.get(d) ?? 0;
    const nb = sellerWorkspaceOn ? (mpByDay.get(d) ?? 0) : 0;
    return { date: d, leafLink: ll, nexbatch: nb, combined: ll + nb };
  });

  const harvestEvents: { day: string; ac: string; lbs: number }[] = [];
  for (const b of batches) {
    const stage = stageFromCultivationUi(b.cultivationUiState);
    if (!isCompleteStage(stage)) continue;
    const ut = b.updatedAt.getTime();
    if (ut < fromMs || ut > toMs) continue;
    const g =
      (Number(b.aGradeFlowerGrams) || 0) +
      (Number(b.popcornGrams) || 0) +
      (Number(b.trimGrams) || 0);
    if (!(g > 0)) continue;
    const lbs = g / GRAMS_PER_LB;
    const ac = String(b.strainAcronym || "").trim().toUpperCase() || "UNK";
    harvestEvents.push({ day: ymdFromUtcMs(ut), ac, lbs });
  }
  const strainTotals = new Map<string, number>();
  for (const e of harvestEvents) {
    strainTotals.set(e.ac, (strainTotals.get(e.ac) ?? 0) + e.lbs);
  }
  const topStrainKeys = [...strainTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);
  const strainLabels = new Map<string, string>();
  for (const b of batches) {
    const ac = String(b.strainAcronym || "").trim().toUpperCase();
    if (ac && !strainLabels.has(ac)) strainLabels.set(ac, String(b.strain || ac).trim() || ac);
  }
  const yieldTrendRows: Record<string, string | number>[] = [];
  for (const d of chartDays) {
    const row: Record<string, string | number> = { date: d };
    for (const ac of topStrainKeys) {
      let sum = 0;
      for (const e of harvestEvents) {
        if (e.ac === ac && e.day <= d) sum += e.lbs;
      }
      row[ac] = Math.round(sum * 100) / 100;
    }
    yieldTrendRows.push(row);
  }
  const yieldTrendsByStrain = {
    strains: topStrainKeys.map((ac) => ({
      key: ac,
      label: strainLabels.get(ac) ?? ac,
    })),
    rows: yieldTrendRows,
  };

  let repeatCustomerPct: number | null = null;
  if (ordersCurrent.customers?.length) {
    let repeat = 0;
    let total = 0;
    for (const c of ordersCurrent.customers) {
      const ordersN = (c.orderCountByDay ?? []).reduce((a, x) => a + x, 0);
      if (ordersN <= 0 && (c.orderTotalInRange ?? 0) <= 0) continue;
      total += 1;
      if (ordersN > 1) repeat += 1;
    }
    repeatCustomerPct = total > 0 ? Math.round((repeat / total) * 1000) / 10 : null;
  }

  const laborByUser = new Map<string, { hours: number; cost: number; stage: string }>();
  for (const e of laborEntriesRange) {
    const cur = laborByUser.get(e.userId) ?? { hours: 0, cost: 0, stage: String(e.stage) };
    cur.hours += Number(e.hours) || 0;
    cur.cost += Number(e.totalCost) || 0;
    laborByUser.set(e.userId, cur);
  }
  const topLaborIds = [...laborByUser.entries()]
    .sort((a, b) => b[1].hours - a[1].hours)
    .slice(0, 6)
    .map(([id]) => id);
  const laborUsers =
    topLaborIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: topLaborIds } },
          select: { id: true, email: true },
        })
      : [];
  const emailById = new Map(laborUsers.map((u) => [u.id, u.email]));
  const topPerformers = topLaborIds.map((id) => {
    const agg = laborByUser.get(id)!;
    const email = emailById.get(id) ?? id;
    const name = email.includes("@") ? email.split("@")[0] : email;
    return {
      userId: id,
      name,
      department: agg.stage,
      hours: Math.round(agg.hours * 10) / 10,
      cost: Math.round(agg.cost * 100) / 100,
      efficiencyPct:
        agg.hours > 0 ? Math.min(100, Math.round((agg.hours / (agg.hours + 0.25)) * 100)) : null,
    };
  });

  const activeExtractions = extractionRuns
    .filter((r) => r.phase !== "COMPLETED" && !r.finishedAt)
    .slice(0, 4)
    .map((r) => ({
      id: r.id,
      phase: r.phase,
      updatedAt: r.updatedAt.toISOString(),
    }));
  const activePackaging = packagingLots
    .filter((p) => p.status === "IN_PROGRESS" && !p.finishedAt)
    .slice(0, 4)
    .map((p) => ({
      id: p.id,
      sku: p.sku,
      units: p.units,
      updatedAt: p.updatedAt.toISOString(),
    }));

  const taskLinkedRecent = await prisma.taskLog.count({
    where: {
      companyId,
      referenceId: { not: null },
      createdAt: { gte: new Date(Date.now() - 14 * 86_400_000) },
    },
  });

  const dowMinutes = [0, 0, 0, 0, 0, 0, 0];
  for (const t of taskLogsRecent) {
    const wd = new Date(t.createdAt).getUTCDay();
    dowMinutes[wd] += Number(t.minutes) || 0;
  }
  const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const downtimeByWeekday = weekdayLabels.map((label, i) => ({
    label,
    minutes: Math.round(dowMinutes[i] ?? 0),
  }));

  const liveOps = [
    ...activeExtractions.slice(0, 2).map((r) => ({
      kind: "extraction_run",
      title: "Extraction run in progress",
      detail: `${r.id.slice(0, 10)}… · ${r.phase}`,
      href: "/extraction",
    })),
    ...activePackaging.slice(0, 2).map((p) => ({
      kind: "packaging_lot",
      title: "Packaging lot running",
      detail: `${p.sku} · ${p.units} units`,
      href: "/packaging",
    })),
    {
      kind: "tasks",
      title: "Task logs with reference (14d)",
      detail: `${taskLinkedRecent} entries`,
      href: "/analytics/live-operations#live-ops-card-task_logs",
    },
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

  let topProducts: { name: string; revenue: number }[] = [];
  if (sellerWorkspaceOn) {
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
    topProducts = [...byName.entries()]
      .map(([name, revenue]) => ({ name, revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 6);
  }

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
      const rev = leafLinkQualifyingRevenueUsd(o);
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
      facilities: services.productionEnabled,
      payrollLabor: services.productionEnabled,
      compliance: services.productionEnabled,
      executive: String(platformRole || "") === "nexbatch_admin",
    },
    kpis: {
      totalRevenue: {
        value: totalRevenue,
        trend: revenueTrend,
        source: sellerWorkspaceOn
          ? "LeafLink + NexBatch marketplace (seller)"
          : "LeafLink wholesale only (seller marketplace workspace off)",
      },
      totalOrders: {
        value: totalOrders,
        trend: ordersTrend,
        leafLink: ordersCurrent.ordersIncluded,
        marketplace: (sellerWorkspaceOn ? sellerOrderCount : 0) + buyerOrderCount,
      },
      activeBatches: { value: activeBatches, cultivationOpen: activeCultivationBatches, extraction: extractionInProgress, packaging: packagingInProgress },
      inventoryValue: {
        value: inventoryValue,
        note: "LeafLink: Σ price × qty (status Available, qty>0 — matches Inventory page defaults)",
      },
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
          yieldTrendsByStrain,
        }
      : null,
    sales: {
      totalSales: leafLinkRevenue + nexbatchForTotals,
      avgOrderValue: (() => {
        const denom = ordersCurrent.ordersIncluded + (sellerWorkspaceOn ? sellerOrderCount : 0);
        return denom > 0 ? (leafLinkRevenue + nexbatchForTotals) / denom : 0;
      })(),
      repeatCustomerPct,
      openInvoices: null as number | null,
      topProducts,
      leafLink: leafLinkRevenue,
      nexbatch: nexbatchForTotals,
      salesOverTime,
    },
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
          laborCostToday,
          laborCostPerHour:
            productiveHours > 0 ? Math.round((laborCostRange / productiveHours) * 100) / 100 : null,
          laborCostPerGram: null as number | null,
          overtimeHours: null as number | null,
          avgProductivityPct:
            paidHours > 0 ? Math.round((productiveHours / (productiveHours + deadHours)) * 100) : null,
          topPerformers,
        }
      : null,
    facilities: services.productionEnabled
      ? {
          openWorkOrdersApprox: taskLinkedRecent,
          overdueRepairs: null as number | null,
          compliancePct: null as number | null,
          equipmentDowntimePct: null as number | null,
          assetsOffline: null as number | null,
          criticalAlerts: alerts.length,
          equipmentHealth: [
            { label: "HVAC", pct: null as number | null },
            { label: "Irrigation", pct: null as number | null },
            { label: "Extraction equipment", pct: null as number | null },
            { label: "Generators", pct: null as number | null },
            { label: "Lighting", pct: null as number | null },
            { label: "Packaging lines", pct: null as number | null },
          ],
          downtimeByWeekday,
        }
      : null,
    businessFinancial: {
      revenue: totalRevenue,
      netProfit: null as number | null,
      ebitda: null as number | null,
      cashFlow: null as number | null,
      revenueByChannel: [
        { label: "LeafLink wholesale", value: leafLinkRevenue },
        { label: "NexBatch marketplace (seller)", value: nexbatchForTotals },
      ],
      accountingNote: "Net profit, EBITDA, and cash flow require accounting system integration.",
    },
    liveOps,
    insights,
    alerts,
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
