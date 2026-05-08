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
