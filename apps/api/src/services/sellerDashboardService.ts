import type { MarketplaceOrderStatus } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";

function startOfDayUtc(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function endOfDayUtc(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(23, 59, 59, 999);
  return x;
}

/** Monday–Sunday week containing `ref`, UTC boundaries. */
export function defaultWeekRangeUtc(ref: Date = new Date()): { from: Date; to: Date } {
  const day = ref.getUTCDay(); // 0 Sun .. 6 Sat
  const daysFromMonday = (day + 6) % 7;
  const monday = startOfDayUtc(ref);
  monday.setUTCDate(monday.getUTCDate() - daysFromMonday);
  const sunday = endOfDayUtc(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { from: monday, to: sunday };
}

function previousPeriod(from: Date, to: Date): { prevFrom: Date; prevTo: Date } {
  const ms = to.getTime() - from.getTime() + 1;
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - ms + 1);
  return { prevFrom, prevTo };
}

function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function eachDayInclusive(from: Date, to: Date): string[] {
  const days: string[] = [];
  const cur = startOfDayUtc(from);
  const end = startOfDayUtc(to);
  while (cur.getTime() <= end.getTime()) {
    days.push(isoDay(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

const NB_REVENUE_STATUSES: MarketplaceOrderStatus[] = ["PENDING", "ACCEPTED", "FULFILLED"];

function isNbOrderCountingRevenue(status: MarketplaceOrderStatus): boolean {
  return NB_REVENUE_STATUSES.includes(status);
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function mapCategoryBucket(category: string | null | undefined, productType: string | null | undefined): string {
  const c = `${category || ""} ${productType || ""}`.toLowerCase();
  if (/(flower|bud|pre\s*-?roll|joint)/i.test(c)) return "Flower";
  if (/(concentrate|extract|rosin|resin|hash|wax|shatter|budder)/i.test(c)) return "Concentrates";
  if (/(vape|cart|cartridge|pod)/i.test(c)) return "Vapes";
  if (/(edible|gumm|chocolate|beverage)/i.test(c)) return "Edibles";
  return "Other";
}

function isLeafLinkOrderExcluded(statusRaw: string): boolean {
  const s = String(statusRaw || "").toLowerCase();
  return (
    s.includes("cancel") ||
    s.includes("void") ||
    s.includes("reject") ||
    s.includes("refund") ||
    s.includes("deleted")
  );
}

function sumLeafLinkOrders(rows: Array<{ totalUsd: number | null; statusRaw: string; createdOn: Date | null }>, from: Date, to: Date): number {
  let sum = 0;
  for (const r of rows) {
    if (!r.createdOn || r.createdOn < from || r.createdOn > to) continue;
    if (isLeafLinkOrderExcluded(r.statusRaw)) continue;
    sum += typeof r.totalUsd === "number" && Number.isFinite(r.totalUsd) ? r.totalUsd : 0;
  }
  return sum;
}

function leafLinkDailyTotals(
  rows: Array<{ totalUsd: number | null; statusRaw: string; createdOn: Date | null }>,
  dayKeys: string[],
  from: Date,
  to: Date,
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const k of dayKeys) map[k] = 0;
  for (const r of rows) {
    if (!r.createdOn || r.createdOn < from || r.createdOn > to) continue;
    if (isLeafLinkOrderExcluded(r.statusRaw)) continue;
    const key = isoDay(r.createdOn);
    if (!(key in map)) continue;
    map[key] += typeof r.totalUsd === "number" && Number.isFinite(r.totalUsd) ? r.totalUsd : 0;
  }
  return map;
}

export type SellerDashboardDto = {
  company: {
    id: string;
    name: string;
    slug: string;
    initials: string;
    locationLine: string | null;
    verifiedSeller: boolean;
  };
  dateRange: { from: string; to: string; label: string; compareLabel: string };
  leafLinkConnected: boolean;
  kpis: {
    totalSales: { value: number; valueFormatted: string; pctChange: number | null; vsLabel: string };
    totalOrders: { value: number; pctChange: number | null; vsLabel: string };
    newCustomers: { value: number; pctChange: number | null; vsLabel: string };
    activeProducts: { value: number; pctChange: number | null; vsLabel: string };
    lowStockItems: { value: number; pctChange: number | null; vsLabel: string };
  };
  salesPanels: {
    nexbatch: { total: number; totalFormatted: string; pctChange: number | null; series: Array<{ day: string; total: number }> };
    leafLink: { total: number; totalFormatted: string; pctChange: number | null; series: Array<{ day: string; total: number }> };
    combined: { total: number; totalFormatted: string; pctChange: number | null; series: Array<{ day: string; total: number }> };
  };
  salesOverview: {
    mode: "nexbatch";
    total: number;
    totalFormatted: string;
    pctChange: number | null;
    series: Array<{ day: string; total: number }>;
  };
  orderStatus: {
    total: number;
    segments: Array<{ key: string; label: string; count: number; color: string }>;
  };
  revenueByCategory: Array<{ category: string; revenue: number; revenueFormatted: string; pct: number }>;
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    customerName: string;
    amount: number;
    amountFormatted: string;
    statusKey: string;
    statusLabel: string;
    source: "nexbatch";
  }>;
  inventoryAlerts: Array<{
    productId: string;
    name: string;
    categoryLine: string;
    quantityAvailable: number;
    unitSize: string | null;
    warning: string;
    imageUrl: string | null;
  }>;
  topSellingProducts: Array<{ rank: number; name: string; categoryLine: string; revenue: number; revenueFormatted: string; qtyLabel: string }>;
  customerOverview: {
    totalCustomers: number;
    repeatCustomers: number;
    repeatPct: number | null;
    newThisPeriod: number;
    topCustomers: Array<{ name: string; totalSpend: number; totalSpendFormatted: string }>;
  };
  crmActivity: Array<{ id: string; kind: string; title: string; subtitle: string; atLabel: string }>;
  reportsOverview: Array<{ id: string; title: string; description: string }>;
  badges: { pendingOrders: number };
};

function initialsFromName(name: string): string {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0] + parts[1]![0]).toUpperCase();
  const one = parts[0] || "NB";
  return one.slice(0, 2).toUpperCase();
}

function mapNbStatusToDisplay(status: MarketplaceOrderStatus): { key: string; label: string } {
  switch (status) {
    case "PENDING":
      return { key: "pending", label: "Pending" };
    case "ACCEPTED":
      return { key: "confirmed", label: "Confirmed" };
    case "FULFILLED":
      return { key: "shipped", label: "Shipped" };
    case "REJECTED":
      return { key: "rejected", label: "Rejected" };
    case "CANCELLED":
      return { key: "cancelled", label: "Cancelled" };
    default:
      return { key: String(status).toLowerCase(), label: status };
  }
}

/** Processing bucket — orders accepted but not yet fulfilled (no distinct DB status). Kept at 0 unless extended later. */
const ORDER_STATUS_COLORS: Record<string, string> = {
  pending: "#f59e0b",
  confirmed: "#22c55e",
  processing: "#3b82f6",
  shipped: "#a855f7",
  rejected: "#64748b",
  cancelled: "#64748b",
};

export async function buildSellerDashboard(options: {
  sellerCompanyId: string;
  from?: Date;
  to?: Date;
  leafLinkInventorySyncEnabled: boolean;
}): Promise<SellerDashboardDto> {
  const sellerCompanyId = options.sellerCompanyId;
  let from = options.from;
  let to = options.to;
  if (from && !to) {
    to = new Date(from.getTime() + 6 * 86400000);
    to.setUTCHours(23, 59, 59, 999);
  } else if (!from && to) {
    from = new Date(to.getTime() - 6 * 86400000);
    from.setUTCHours(0, 0, 0, 0);
  } else if (!from || !to) {
    const w = defaultWeekRangeUtc();
    from = w.from;
    to = w.to;
  }
  if (from > to) {
    const tmp = from;
    from = to;
    to = tmp;
  }

  const { prevFrom, prevTo } = previousPeriod(from, to);
  const dayKeys = eachDayInclusive(from, to);

  const company = await prisma.company.findUnique({
    where: { id: sellerCompanyId },
    select: { id: true, name: true, slug: true },
  });
  if (!company) throw new AppError("Company not found", 404, "COMPANY_NOT_FOUND");

  const leafLinkConnected = Boolean(options.leafLinkInventorySyncEnabled);

  const [nbOrdersCur, nbOrdersPrev, llRows, products] = await Promise.all([
    prisma.marketplaceOrder.findMany({
      where: { sellerCompanyId, createdAt: { gte: from, lte: to } },
      include: { buyerCompany: { select: { name: true } }, items: true },
    }),
    prisma.marketplaceOrder.findMany({
      where: { sellerCompanyId, createdAt: { gte: prevFrom, lte: prevTo } },
      include: { items: true },
    }),
    leafLinkConnected
      ? prisma.leafLinkStoredOrder.findMany({
          where: {
            companyId: sellerCompanyId,
            createdOn: { gte: prevFrom, lte: to },
          },
          select: { totalUsd: true, statusRaw: true, createdOn: true, leafLinkKey: true, customerName: true },
        })
      : Promise.resolve([]),
    prisma.marketplaceProduct.findMany({
      where: { companyId: sellerCompanyId },
      select: {
        id: true,
        name: true,
        category: true,
        productType: true,
        quantityAvailable: true,
        unitSize: true,
        imageUrl: true,
        availabilityStatus: true,
      },
    }),
  ]);

  const nbTotalCur = nbOrdersCur.filter((o) => isNbOrderCountingRevenue(o.status)).reduce((s, o) => s + o.total, 0);
  const nbTotalPrev = nbOrdersPrev.filter((o) => isNbOrderCountingRevenue(o.status)).reduce((s, o) => s + o.total, 0);

  const llTotalCur = leafLinkConnected ? sumLeafLinkOrders(llRows, from, to) : 0;
  const llTotalPrev = leafLinkConnected ? sumLeafLinkOrders(llRows, prevFrom, prevTo) : 0;

  const combinedTotalCur = nbTotalCur + llTotalCur;
  const combinedTotalPrev = nbTotalPrev + llTotalPrev;

  const nbDaily = (orders: typeof nbOrdersCur, rangeFrom: Date, rangeTo: Date): Record<string, number> => {
    const map: Record<string, number> = {};
    for (const k of dayKeys) map[k] = 0;
    for (const o of orders) {
      if (!isNbOrderCountingRevenue(o.status)) continue;
      if (o.createdAt < rangeFrom || o.createdAt > rangeTo) continue;
      const key = isoDay(o.createdAt);
      if (!(key in map)) continue;
      map[key] += o.total;
    }
    return map;
  };

  const nbSeriesCur = nbDaily(nbOrdersCur, from, to);

  const llSeriesCur = leafLinkConnected ? leafLinkDailyTotals(llRows, dayKeys, from, to) : Object.fromEntries(dayKeys.map((k) => [k, 0]));

  const combinedSeries = dayKeys.map((day) => ({
    day,
    total: (nbSeriesCur[day] || 0) + (llSeriesCur[day] || 0),
  }));

  const ordersCurCount = nbOrdersCur.filter((o) => isNbOrderCountingRevenue(o.status)).length;
  const ordersPrevCount = nbOrdersPrev.filter((o) => isNbOrderCountingRevenue(o.status)).length;

  /** First-time buyers (with this seller) whose first order falls in range. */
  async function countNewCustomers(rangeFrom: Date, rangeTo: Date): Promise<number> {
    const buyers = await prisma.marketplaceOrder.groupBy({
      by: ["buyerCompanyId"],
      where: { sellerCompanyId, createdAt: { lte: rangeTo } },
      _min: { createdAt: true },
    });
    let n = 0;
    for (const row of buyers) {
      const firstAt = row._min.createdAt;
      if (!firstAt) continue;
      if (firstAt >= rangeFrom && firstAt <= rangeTo) n += 1;
    }
    return n;
  }

  const newCur = await countNewCustomers(from, to);
  const newPrev = await countNewCustomers(prevFrom, prevTo);

  const activeCur = products.filter((p) => p.availabilityStatus === "AVAILABLE").length;

  const LOW_STOCK_MAX = 50;
  const lowStockCur = products.filter(
    (p) => p.availabilityStatus === "AVAILABLE" && p.quantityAvailable > 0 && p.quantityAvailable <= LOW_STOCK_MAX,
  ).length;

  const compareLabel = `${isoDay(prevFrom)} – ${isoDay(prevTo)}`;

  /** Order status donut — map DB statuses to UI buckets. */
  const statusBuckets: Record<string, number> = {
    pending: 0,
    confirmed: 0,
    processing: 0,
    shipped: 0,
  };
  for (const o of nbOrdersCur) {
    if (o.status === "PENDING") statusBuckets.pending += 1;
    else if (o.status === "ACCEPTED") statusBuckets.confirmed += 1;
    else if (o.status === "FULFILLED") statusBuckets.shipped += 1;
  }
  /** Placeholder processing count — data model has no distinct “processing” state yet. */
  statusBuckets.processing = 0;

  const segments = [
    { key: "pending", label: "Pending", count: statusBuckets.pending, color: ORDER_STATUS_COLORS.pending },
    { key: "confirmed", label: "Confirmed", count: statusBuckets.confirmed, color: ORDER_STATUS_COLORS.confirmed },
    { key: "processing", label: "Processing", count: statusBuckets.processing, color: ORDER_STATUS_COLORS.processing },
    { key: "shipped", label: "Shipped", count: statusBuckets.shipped, color: ORDER_STATUS_COLORS.shipped },
  ];

  const orderStatusTotal = segments.reduce((s, x) => s + x.count, 0);

  /** Revenue by category from NexBatch order lines */
  const catTotals: Record<string, number> = { Flower: 0, Concentrates: 0, Vapes: 0, Edibles: 0, Other: 0 };
  for (const o of nbOrdersCur) {
    if (!isNbOrderCountingRevenue(o.status)) continue;
    for (const it of o.items) {
      const prod = products.find((p) => p.id === it.productId);
      const bucket = mapCategoryBucket(prod?.category ?? null, prod?.productType ?? null);
      catTotals[bucket] = (catTotals[bucket] || 0) + it.lineTotal;
    }
  }
  const catSum = Object.values(catTotals).reduce((a, b) => a + b, 0);
  const revenueByCategory = (["Flower", "Concentrates", "Vapes", "Edibles", "Other"] as const).map((category) => {
    const revenue = catTotals[category] || 0;
    const pct = catSum > 0 ? (revenue / catSum) * 100 : 0;
    return { category, revenue, revenueFormatted: formatUsd(revenue), pct };
  });

  /** Recent NexBatch seller orders */
  const recentNb = [...nbOrdersCur].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 8);
  const recentOrders = recentNb.map((o) => {
    const disp = mapNbStatusToDisplay(o.status);
    return {
      id: o.id,
      orderNumber: `#NB-${String(o.id).slice(-5).toUpperCase()}`,
      customerName: o.buyerCompany?.name || "Customer",
      amount: o.total,
      amountFormatted: formatUsd(o.total),
      statusKey: disp.key,
      statusLabel: disp.label,
      source: "nexbatch" as const,
    };
  });

  /** Inventory alerts — lowest qty AVAILABLE first */
  const inventoryAlerts = products
    .filter((p) => p.availabilityStatus === "AVAILABLE" && p.quantityAvailable > 0 && p.quantityAvailable <= LOW_STOCK_MAX)
    .sort((a, b) => a.quantityAvailable - b.quantityAvailable)
    .slice(0, 8)
    .map((p) => {
      const u = p.unitSize?.trim() || "units";
      return {
        productId: p.id,
        name: p.name,
        categoryLine: [p.category, p.productType].filter(Boolean).join(" · ") || "Product",
        quantityAvailable: p.quantityAvailable,
        unitSize: p.unitSize,
        warning: `Low stock: ${p.quantityAvailable} ${u} left`,
        imageUrl: p.imageUrl,
      };
    });

  /** Top products by line revenue */
  const prodRev: Record<string, { revenue: number; qty: number; name: string; categoryLine: string }> = {};
  for (const o of nbOrdersCur) {
    if (!isNbOrderCountingRevenue(o.status)) continue;
    for (const it of o.items) {
      const key = it.productId || it.productNameSnapshot;
      const prod = products.find((p) => p.id === it.productId);
      const name = prod?.name || it.productNameSnapshot;
      const categoryLine = [prod?.category, prod?.productType].filter(Boolean).join(" · ") || "Product";
      if (!prodRev[key]) prodRev[key] = { revenue: 0, qty: 0, name, categoryLine };
      prodRev[key].revenue += it.lineTotal;
      prodRev[key].qty += it.quantity;
    }
  }
  const topSellingProducts = Object.values(prodRev)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)
    .map((row, i) => ({
      rank: i + 1,
      name: row.name,
      categoryLine: row.categoryLine,
      revenue: row.revenue,
      revenueFormatted: formatUsd(row.revenue),
      qtyLabel: `${row.qty} units`,
    }));

  /** Customers */
  const buyerTotals = await prisma.marketplaceOrder.groupBy({
    by: ["buyerCompanyId"],
    where: { sellerCompanyId, status: { in: NB_REVENUE_STATUSES } },
    _sum: { total: true },
  });
  const buyerIds = buyerTotals.map((b) => b.buyerCompanyId);
  const buyerCompanies = await prisma.company.findMany({
    where: { id: { in: buyerIds } },
    select: { id: true, name: true },
  });
  const nameByBuyer = new Map(buyerCompanies.map((c) => [c.id, c.name]));

  const totalCustomers = buyerTotals.filter((b) => (b._sum.total || 0) > 0).length;

  const orderCountsByBuyer = await prisma.marketplaceOrder.groupBy({
    by: ["buyerCompanyId"],
    where: { sellerCompanyId },
    _count: { _all: true },
  });
  const repeatCustomers = orderCountsByBuyer.filter((r) => r._count._all >= 2).length;
  const repeatPct = totalCustomers > 0 ? (repeatCustomers / totalCustomers) * 100 : null;

  const topCustomers = buyerTotals
    .map((b) => ({
      name: nameByBuyer.get(b.buyerCompanyId) || "Customer",
      totalSpend: b._sum.total || 0,
      totalSpendFormatted: formatUsd(b._sum.total || 0),
    }))
    .sort((a, b) => b.totalSpend - a.totalSpend)
    .slice(0, 5);

  /** CRM activity — derived when no CRM module exists */
  const crmActivity: SellerDashboardDto["crmActivity"] = [];
  let salt = 0;
  for (const o of recentNb.slice(0, 3)) {
    crmActivity.push({
      id: `ord-${o.id}`,
      kind: "order",
      title: "Order update",
      subtitle: `Order ${String(o.id).slice(-6)} ${mapNbStatusToDisplay(o.status).label}`,
      atLabel: `${Math.min(180, 5 + salt * 40)}m ago`,
    });
    salt += 1;
  }
  if (leafLinkConnected && llRows.length) {
    const recentLl = [...llRows]
      .filter((r) => r.createdOn && r.createdOn >= from && r.createdOn <= to)
      .sort((a, b) => (b.createdOn?.getTime() || 0) - (a.createdOn?.getTime() || 0))
      .slice(0, 2);
    for (const r of recentLl) {
      crmActivity.push({
        id: `ll-${r.leafLinkKey}`,
        kind: "leaflink",
        title: "LeafLink order synced",
        subtitle: r.customerName || "Customer",
        atLabel: "Recently",
      });
    }
  }

  const reportsOverview = [
    { id: "sales", title: "Sales Report", description: "Overview of sales performance" },
    { id: "inventory", title: "Inventory Report", description: "Stock levels and movements" },
    { id: "customers", title: "Customer Report", description: "Customer insights and trends" },
    { id: "products", title: "Product Performance", description: "Best and worst performing products" },
    { id: "pnl", title: "Profit & Loss", description: "Revenue, costs and profit analysis" },
  ];

  const pendingOrders = await prisma.marketplaceOrder.count({
    where: { sellerCompanyId, status: "PENDING" },
  });

  const dateRangeLabel = `${isoDay(from).replace(/^\d{4}-/, "")} – ${isoDay(to)}`;

  return {
    company: {
      id: company.id,
      name: company.name,
      slug: company.slug,
      initials: initialsFromName(company.name),
      locationLine: null,
      verifiedSeller: true,
    },
    dateRange: {
      from: from.toISOString(),
      to: to.toISOString(),
      label: dateRangeLabel,
      compareLabel,
    },
    leafLinkConnected,
    kpis: {
      totalSales: {
        value: nbTotalCur,
        valueFormatted: formatUsd(nbTotalCur),
        pctChange: pctChange(nbTotalCur, nbTotalPrev),
        vsLabel: compareLabel,
      },
      totalOrders: {
        value: ordersCurCount,
        pctChange: pctChange(ordersCurCount, ordersPrevCount),
        vsLabel: compareLabel,
      },
      newCustomers: {
        value: newCur,
        pctChange: pctChange(newCur, newPrev),
        vsLabel: compareLabel,
      },
      activeProducts: {
        value: activeCur,
        pctChange: null,
        vsLabel: compareLabel,
      },
      lowStockItems: {
        value: lowStockCur,
        pctChange: null,
        vsLabel: compareLabel,
      },
    },
    salesPanels: {
      nexbatch: {
        total: nbTotalCur,
        totalFormatted: formatUsd(nbTotalCur),
        pctChange: pctChange(nbTotalCur, nbTotalPrev),
        series: dayKeys.map((day) => ({ day, total: nbSeriesCur[day] || 0 })),
      },
      leafLink: {
        total: llTotalCur,
        totalFormatted: formatUsd(llTotalCur),
        pctChange: pctChange(llTotalCur, llTotalPrev),
        series: dayKeys.map((day) => ({ day, total: llSeriesCur[day] || 0 })),
      },
      combined: {
        total: combinedTotalCur,
        totalFormatted: formatUsd(combinedTotalCur),
        pctChange: pctChange(combinedTotalCur, combinedTotalPrev),
        series: combinedSeries,
      },
    },
    salesOverview: {
      mode: "nexbatch",
      total: nbTotalCur,
      totalFormatted: formatUsd(nbTotalCur),
      pctChange: pctChange(nbTotalCur, nbTotalPrev),
      series: dayKeys.map((day) => ({ day, total: nbSeriesCur[day] || 0 })),
    },
    orderStatus: {
      total: orderStatusTotal,
      segments,
    },
    revenueByCategory,
    recentOrders,
    inventoryAlerts,
    topSellingProducts,
    customerOverview: {
      totalCustomers,
      repeatCustomers,
      repeatPct,
      newThisPeriod: newCur,
      topCustomers,
    },
    crmActivity: crmActivity.slice(0, 8),
    reportsOverview,
    badges: { pendingOrders },
  };
}
