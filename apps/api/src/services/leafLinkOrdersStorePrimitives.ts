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

/** Hard ceiling for wholesale order catalogue reads from Postgres (`findRecent…`, analytics null repair). */
export const STORED_ORDER_FETCH_HARD_CAP = 25_000;

export async function countLeafLinkStoredOrdersForCompany(companyId: string): Promise<number> {
  const cid = String(companyId ?? "").trim();
  if (!cid) return 0;
  return prisma.leafLinkStoredOrder.count({ where: { companyId: cid } });
}

/**
 * Newest **placed** wholesale order for realtime toasts (`GET /api/orders/latest-live`).
 * Uses LeafLink `createdOn` (not `updatedAt`) so bulk re-sync does not flip “latest” across random rows.
 */
export async function findLatestLeafLinkStoredOrderLive(
  companyId: string,
): Promise<{
  id: string;
  leafLinkKey: string;
  customerName: string;
  totalUsd: number | null;
  createdOn: string | null;
} | null> {
  const cid = String(companyId ?? "").trim();
  if (!cid) return null;
  const select = {
    id: true,
    leafLinkKey: true,
    customerName: true,
    totalUsd: true,
    createdOn: true,
  } as const;

  const withDate = await prisma.leafLinkStoredOrder.findFirst({
    where: { companyId: cid, createdOn: { not: null } },
    orderBy: [{ createdOn: "desc" }, { updatedAt: "desc" }],
    select,
  });
  const row =
    withDate
    ?? (await prisma.leafLinkStoredOrder.findFirst({
      where: { companyId: cid },
      orderBy: { updatedAt: "desc" },
      select,
    }));
  if (!row) return null;
  return {
    id: row.id,
    leafLinkKey: row.leafLinkKey,
    customerName: row.customerName,
    totalUsd: row.totalUsd,
    createdOn: row.createdOn ? row.createdOn.toISOString() : null,
  };
}

export async function findLatestLeafLinkStoredOrderLiveWithPayload(
  companyId: string,
): Promise<{
  id: string;
  leafLinkKey: string;
  customerName: string;
  totalUsd: number | null;
  createdOn: Date | null;
  payload: unknown;
} | null> {
  const cid = String(companyId ?? "").trim();
  if (!cid) return null;
  const select = {
    id: true,
    leafLinkKey: true,
    customerName: true,
    totalUsd: true,
    createdOn: true,
    payload: true,
  } as const;

  const withDate = await prisma.leafLinkStoredOrder.findFirst({
    where: { companyId: cid, createdOn: { not: null } },
    orderBy: [{ createdOn: "desc" }, { updatedAt: "desc" }],
    select,
  });
  const row =
    withDate
    ?? (await prisma.leafLinkStoredOrder.findFirst({
      where: { companyId: cid },
      orderBy: { updatedAt: "desc" },
      select,
    }));
  if (!row) return null;
  return {
    id: row.id,
    leafLinkKey: row.leafLinkKey,
    customerName: row.customerName,
    totalUsd: row.totalUsd,
    createdOn: row.createdOn,
    payload: row.payload,
  };
}

export type LeafLinkStoredOrderUpsertStats = {
  created: number;
  updated: number;
  skippedUnchanged: number;
};

/** Stable fingerprint for skip-unchanged upserts during incremental sync. */
export function leafLinkStoredOrderFingerprint(row: LeafLinkStoredOrderUpsertInput): string {
  const created = row.createdOn ? row.createdOn.toISOString() : "";
  return [
    row.leafLinkKey,
    row.buyerCustomerId,
    row.customerName,
    row.statusRaw,
    created,
    row.totalUsd == null ? "" : String(row.totalUsd),
    JSON.stringify(row.payload),
  ].join("|");
}

const UPSERT_BATCH_SIZE = 50;

export async function upsertLeafLinkStoredOrders(
  companyId: string,
  rows: LeafLinkStoredOrderUpsertInput[],
): Promise<LeafLinkStoredOrderUpsertStats> {
  const cid = String(companyId ?? "").trim();
  const stats: LeafLinkStoredOrderUpsertStats = { created: 0, updated: 0, skippedUnchanged: 0 };
  if (!cid || rows.length === 0) return stats;

  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
    const keys = batch.map((r) => r.leafLinkKey);
    const existing = await prisma.leafLinkStoredOrder.findMany({
      where: { companyId: cid, leafLinkKey: { in: keys } },
      select: {
        leafLinkKey: true,
        buyerCustomerId: true,
        customerName: true,
        statusRaw: true,
        createdOn: true,
        totalUsd: true,
        payload: true,
      },
    });
    const existingByKey = new Map(
      existing.map((e) => [
        e.leafLinkKey,
        leafLinkStoredOrderFingerprint({
          leafLinkKey: e.leafLinkKey,
          buyerCustomerId: e.buyerCustomerId,
          customerName: e.customerName,
          statusRaw: e.statusRaw,
          createdOn: e.createdOn,
          totalUsd: e.totalUsd,
          payload: e.payload as Prisma.InputJsonValue,
          sourcePage: null,
        }),
      ]),
    );

    const toCreate: LeafLinkStoredOrderUpsertInput[] = [];
    const toUpdate: LeafLinkStoredOrderUpsertInput[] = [];

    for (const row of batch) {
      const fp = leafLinkStoredOrderFingerprint(row);
      const prev = existingByKey.get(row.leafLinkKey);
      if (prev === fp) {
        stats.skippedUnchanged += 1;
        continue;
      }
      if (prev === undefined) toCreate.push(row);
      else toUpdate.push(row);
    }

    if (toCreate.length) {
      await prisma.leafLinkStoredOrder.createMany({
        data: toCreate.map((row) => ({
          companyId: cid,
          leafLinkKey: row.leafLinkKey,
          buyerCustomerId: row.buyerCustomerId,
          customerName: row.customerName,
          statusRaw: row.statusRaw,
          createdOn: row.createdOn,
          totalUsd: row.totalUsd,
          payload: row.payload,
          sourcePage: row.sourcePage,
        })),
        skipDuplicates: true,
      });
      stats.created += toCreate.length;
    }

    for (const row of toUpdate) {
      await prisma.leafLinkStoredOrder.update({
        where: {
          companyId_leafLinkKey: { companyId: cid, leafLinkKey: row.leafLinkKey },
        },
        data: {
          buyerCustomerId: row.buyerCustomerId,
          customerName: row.customerName,
          statusRaw: row.statusRaw,
          createdOn: row.createdOn,
          totalUsd: row.totalUsd,
          payload: row.payload,
          sourcePage: row.sourcePage ?? undefined,
        },
      });
      stats.updated += 1;
    }
  }

  return stats;
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
  const cap = Math.max(1, Math.min(STORED_ORDER_FETCH_HARD_CAP, Math.floor(limit || 1)));
  return prisma.leafLinkStoredOrder.findMany({
    where: { companyId: cid, createdOn: null },
    select: { id: true, payload: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: cap,
  });
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
    take: Math.max(1, Math.min(STORED_ORDER_FETCH_HARD_CAP, Math.floor(limit || 500))),
  });
  return rows;
}
