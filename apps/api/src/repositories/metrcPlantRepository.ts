import { prisma } from "../config/prisma.js";

export type MetrcPlantUpsertRow = {
  metrcPlantId: string;
  label: string;
  licenseNumber: string;
  sourcePlantBatchId: string;
  sourcePlantBatchName: string;
  strainName: string;
  growthPhase: string;
  metrcLocationId: string;
  locationName: string;
  plantedDate: Date | null;
  active: boolean;
  rawPayloadJson: string;
  lastSyncedAt: Date;
};

export async function upsertMetrcPlantsForCompany(
  companyId: string,
  rows: MetrcPlantUpsertRow[],
): Promise<number> {
  if (!rows.length) return 0;
  await prisma.$transaction(
    rows.map((row) =>
      prisma.metrcPlant.upsert({
        where: {
          companyId_label: {
            companyId,
            label: row.label,
          },
        },
        create: {
          companyId,
          metrcPlantId: row.metrcPlantId,
          label: row.label,
          licenseNumber: row.licenseNumber,
          sourcePlantBatchId: row.sourcePlantBatchId,
          sourcePlantBatchName: row.sourcePlantBatchName,
          strainName: row.strainName,
          growthPhase: row.growthPhase,
          metrcLocationId: row.metrcLocationId,
          locationName: row.locationName,
          plantedDate: row.plantedDate,
          active: row.active,
          rawPayloadJson: row.rawPayloadJson,
          lastSyncedAt: row.lastSyncedAt,
        },
        update: {
          metrcPlantId: row.metrcPlantId,
          licenseNumber: row.licenseNumber,
          sourcePlantBatchId: row.sourcePlantBatchId,
          sourcePlantBatchName: row.sourcePlantBatchName,
          strainName: row.strainName,
          growthPhase: row.growthPhase,
          metrcLocationId: row.metrcLocationId,
          locationName: row.locationName,
          plantedDate: row.plantedDate,
          active: row.active,
          rawPayloadJson: row.rawPayloadJson,
          lastSyncedAt: row.lastSyncedAt,
        },
      }),
    ),
  );
  return rows.length;
}

export async function listMetrcPlantsForCompany(companyId: string, metrcPlantBatchId?: string) {
  const batchId = String(metrcPlantBatchId || "").trim();
  return prisma.metrcPlant.findMany({
    where: batchId ? { companyId, sourcePlantBatchId: batchId } : { companyId },
    orderBy: [{ label: "asc" }],
  });
}

export async function findMetrcPlantByLabel(companyId: string, label: string) {
  const trimmed = String(label || "").trim();
  if (!trimmed) return null;
  return prisma.metrcPlant.findFirst({
    where: { companyId, label: trimmed },
  });
}

export async function listMetrcPlantsForPlantBatch(companyId: string, plantBatch: {
  metrcPlantBatchId: string;
  name: string;
}) {
  const rows = await listMetrcPlantsForCompany(companyId);
  const id = plantBatch.metrcPlantBatchId.trim();
  const nameLower = plantBatch.name.trim().toLowerCase();
  return rows.filter(
    (p) =>
      p.active &&
      (p.sourcePlantBatchId === id ||
        (nameLower && p.sourcePlantBatchName.trim().toLowerCase() === nameLower)),
  );
}
