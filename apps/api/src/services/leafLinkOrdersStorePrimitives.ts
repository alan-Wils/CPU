import type { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";

/** DB row payload is either LeafLink JSON or `{ _cpu_v: 1, summary }` (enriched detail). See `LeafLinkOrdersService`. */
export type LeafLinkStoredOrderUpsertInput = {
  leafLinkKey: string;
  buyerCustomerId: string;
  customerName: string;
  statusRaw: string;
  createdOn: Date | null;
  totalUsd: number | null;
  payload: Prisma.InputJsonValue;
  sourcePage: number | null;
};

export async function upsertLeafLinkStoredOrders(
  companyId: string,
  rows: LeafLinkStoredOrderUpsertInput[],
): Promise<void> {
  const cid = String(companyId ?? "").trim();
  if (!cid || rows.length === 0) return;
  for (const row of rows) {
    await prisma.leafLinkStoredOrder.upsert({
      where: {
        companyId_leafLinkKey: { companyId: cid, leafLinkKey: row.leafLinkKey },
      },
      create: {
        companyId: cid,
        leafLinkKey: row.leafLinkKey,
        buyerCustomerId: row.buyerCustomerId,
        customerName: row.customerName,
        statusRaw: row.statusRaw,
        createdOn: row.createdOn,
        totalUsd: row.totalUsd,
        payload: row.payload,
        sourcePage: row.sourcePage,
      },
      update: {
        buyerCustomerId: row.buyerCustomerId,
        customerName: row.customerName,
        statusRaw: row.statusRaw,
        createdOn: row.createdOn,
        totalUsd: row.totalUsd,
        payload: row.payload,
        sourcePage: row.sourcePage ?? undefined,
      },
    });
  }
}

export async function findLeafLinkStoredOrdersForCompanyInRange(
  companyId: string,
  range: { from: Date; to: Date },
): Promise<{ id: string; payload: unknown; updatedAt: Date }[]> {
  const cid = String(companyId ?? "").trim();
  if (!cid) return [];
  const rows = await prisma.leafLinkStoredOrder.findMany({
    where: {
      companyId: cid,
      createdOn: { gte: range.from, lte: range.to },
    },
    select: {
      id: true,
      payload: true,
      updatedAt: true,
    },
    orderBy: { createdOn: "desc" },
  });
  return rows;
}

/**
 * Rows upserted before we parsed full LeafLink `created_on` fields can have `createdOn: null`; they won't match the range query above.
 * Analytics merges a capped recent-null set filtered in-memory by payload dates.
 */
export async function findRecentLeafLinkStoredOrdersWithNullCreatedOn(
  companyId: string,
  limit: number,
): Promise<{ id: string; payload: unknown; updatedAt: Date }[]> {
  const cid = String(companyId ?? "").trim();
  if (!cid) return [];
  const cap = Math.max(1, Math.min(5000, Math.floor(limit || 1)));
  return prisma.leafLinkStoredOrder.findMany({
    where: { companyId: cid, createdOn: null },
    select: { id: true, payload: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: cap,
  });
}

/**
 * Newest stored LeafLink order row for realtime “new order” UI (poll).
 * Orders `createdOn` desc, then `createdAt` so null `createdOn` rows still sort sensibly.
 */
export async function findLatestLeafLinkStoredOrderLive(companyId: string): Promise<{
  id: string;
  leafLinkKey: string;
  customerName: string;
  totalUsd: number | null;
  createdOn: string | null;
} | null> {
  const cid = String(companyId ?? "").trim();
  if (!cid) return null;
  const row = await prisma.leafLinkStoredOrder.findFirst({
    where: { companyId: cid },
    orderBy: [{ createdOn: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      leafLinkKey: true,
      customerName: true,
      totalUsd: true,
      createdOn: true,
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    leafLinkKey: row.leafLinkKey,
    customerName: String(row.customerName || "").trim() || "Customer",
    totalUsd: row.totalUsd,
    createdOn: row.createdOn?.toISOString() ?? null,
  };
}

export async function findRecentLeafLinkStoredOrdersForCompany(
  companyId: string,
  limit: number,
): Promise<{ id: string; leafLinkKey: string; totalUsd: number | null; payload: unknown; createdOn: Date | null; updatedAt: Date }[]> {
  const cid = String(companyId ?? "").trim();
  if (!cid) return [];
  const rows = await prisma.leafLinkStoredOrder.findMany({
    where: { companyId: cid },
    select: {
      id: true,
      leafLinkKey: true,
      totalUsd: true,
      payload: true,
      createdOn: true,
      updatedAt: true,
    },
    orderBy: [{ createdOn: "desc" }, { updatedAt: "desc" }],
    take: Math.max(1, Math.min(5000, Math.floor(limit || 500))),
  });
  return rows;
}
