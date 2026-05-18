import type { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";

const g = (n: number) => Number(Number(n).toFixed(4));

/** Sum of ACTIVE reservation grams for one extraction run. */
export async function sumActiveReservedGrams(
  companyId: string,
  extractionRunId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  const agg = await db.edibleOilReservation.aggregate({
    where: { companyId, extractionRunId, status: "ACTIVE" },
    _sum: { reservedGrams: true },
  });
  return g(Number(agg._sum.reservedGrams ?? 0));
}

/**
 * When oil is used in an edible batch, reduce ACTIVE reservations oldest-first (FIFO).
 */
export async function consumeReservationsForOilUse(
  companyId: string,
  extractionRunId: string,
  oilGrams: number,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  let remaining = g(oilGrams);
  if (remaining <= 0) return;

  const rows = await db.edibleOilReservation.findMany({
    where: { companyId, extractionRunId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });

  for (const row of rows) {
    if (remaining <= 0.0001) break;
    const hold = g(Number(row.reservedGrams));
    if (hold <= 0.0001) {
      await db.edibleOilReservation.update({
        where: { id: row.id },
        data: { status: "CONSUMED", reservedGrams: 0, releasedAt: new Date() },
      });
      continue;
    }
    const take = Math.min(hold, remaining);
    const left = g(hold - take);
    remaining = g(remaining - take);
    if (left <= 0.0001) {
      await db.edibleOilReservation.update({
        where: { id: row.id },
        data: { status: "CONSUMED", reservedGrams: 0, releasedAt: new Date() },
      });
    } else {
      await db.edibleOilReservation.update({
        where: { id: row.id },
        data: { reservedGrams: left },
      });
    }
  }
}

export function computeOilPoolAvailableGrams(
  outputGrams: number,
  packagingGrams: number,
  ediblesGrams: number,
  reservedGrams: number,
): number {
  return Math.max(0, g(outputGrams - packagingGrams - ediblesGrams - reservedGrams));
}
