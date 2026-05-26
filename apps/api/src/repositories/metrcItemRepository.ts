import { prisma } from "../config/prisma.js";

export type MetrcItemUpsertRow = {
  metrcItemId: string;
  licenseNumber: string;
  itemName: string;
  categoryName: string;
  unitOfMeasureName: string;
  quantityType: string;
  rawPayloadJson: string;
  lastSyncedAt: Date;
};

export async function upsertMetrcItemsForCompany(
  companyId: string,
  rows: MetrcItemUpsertRow[],
): Promise<number> {
  if (!rows.length) return 0;
  await prisma.$transaction(
    rows.map((row) =>
      prisma.metrcItem.upsert({
        where: {
          companyId_metrcItemId: {
            companyId,
            metrcItemId: row.metrcItemId,
          },
        },
        create: {
          companyId,
          metrcItemId: row.metrcItemId,
          licenseNumber: row.licenseNumber,
          itemName: row.itemName,
          categoryName: row.categoryName,
          unitOfMeasureName: row.unitOfMeasureName,
          quantityType: row.quantityType,
          rawPayloadJson: row.rawPayloadJson,
          lastSyncedAt: row.lastSyncedAt,
        },
        update: {
          licenseNumber: row.licenseNumber,
          itemName: row.itemName,
          categoryName: row.categoryName,
          unitOfMeasureName: row.unitOfMeasureName,
          quantityType: row.quantityType,
          rawPayloadJson: row.rawPayloadJson,
          lastSyncedAt: row.lastSyncedAt,
        },
      }),
    ),
  );
  return rows.length;
}

export async function listMetrcItemsForCompany(companyId: string) {
  return prisma.metrcItem.findMany({
    where: { companyId },
    orderBy: [{ itemName: "asc" }, { metrcItemId: "asc" }],
  });
}

export async function findMetrcItemById(companyId: string, metrcItemId: string) {
  const id = String(metrcItemId || "").trim();
  if (!id) return null;
  return prisma.metrcItem.findUnique({
    where: {
      companyId_metrcItemId: { companyId, metrcItemId: id },
    },
  });
}

export async function findMetrcItemByName(companyId: string, itemName: string) {
  const trimmed = String(itemName || "").trim();
  if (!trimmed) return null;
  const rows = await prisma.metrcItem.findMany({ where: { companyId } });
  const lower = trimmed.toLowerCase();
  return rows.find((r) => r.itemName.trim().toLowerCase() === lower) ?? null;
}
