import { prisma } from "../config/prisma.js";

export type MetrcHarvestUpsertRow = {
  metrcHarvestId: string;
  licenseNumber: string;
  harvestName: string;
  sourcePlantBatchId: string;
  sourcePlantBatchName: string;
  strainName: string;
  metrcLocationId: string;
  locationName: string;
  harvestType: string;
  wetWeight: number;
  totalWeight: number;
  unitOfWeight: string;
  patientLicenseNumber: string;
  sourcePlantLabelsJson?: string;
  plantedDate: Date | null;
  finishedDate: Date | null;
  active: boolean;
  createdViaTest: boolean;
  rawPayloadJson: string;
  lastModified: Date | null;
  lastSyncedAt: Date;
};

export async function upsertMetrcHarvestsForCompany(
  companyId: string,
  rows: MetrcHarvestUpsertRow[],
): Promise<number> {
  if (!rows.length) return 0;
  await prisma.$transaction(
    rows.map((row) =>
      prisma.metrcHarvest.upsert({
        where: {
          companyId_metrcHarvestId: {
            companyId,
            metrcHarvestId: row.metrcHarvestId,
          },
        },
        create: {
          companyId,
          metrcHarvestId: row.metrcHarvestId,
          licenseNumber: row.licenseNumber,
          harvestName: row.harvestName,
          sourcePlantBatchId: row.sourcePlantBatchId,
          sourcePlantBatchName: row.sourcePlantBatchName,
          strainName: row.strainName,
          metrcLocationId: row.metrcLocationId,
          locationName: row.locationName,
          harvestType: row.harvestType,
          wetWeight: row.wetWeight,
          totalWeight: row.totalWeight,
          unitOfWeight: row.unitOfWeight,
          patientLicenseNumber: row.patientLicenseNumber,
          sourcePlantLabelsJson: row.sourcePlantLabelsJson ?? "[]",
          plantedDate: row.plantedDate,
          finishedDate: row.finishedDate,
          active: row.active,
          createdViaTest: row.createdViaTest,
          rawPayloadJson: row.rawPayloadJson,
          lastModified: row.lastModified,
          lastSyncedAt: row.lastSyncedAt,
        },
        update: {
          licenseNumber: row.licenseNumber,
          harvestName: row.harvestName,
          sourcePlantBatchId: row.sourcePlantBatchId,
          sourcePlantBatchName: row.sourcePlantBatchName,
          strainName: row.strainName,
          metrcLocationId: row.metrcLocationId,
          locationName: row.locationName,
          harvestType: row.harvestType,
          wetWeight: row.wetWeight,
          totalWeight: row.totalWeight,
          unitOfWeight: row.unitOfWeight,
          patientLicenseNumber: row.patientLicenseNumber,
          ...(row.sourcePlantLabelsJson ? { sourcePlantLabelsJson: row.sourcePlantLabelsJson } : {}),
          plantedDate: row.plantedDate,
          finishedDate: row.finishedDate,
          active: row.active,
          rawPayloadJson: row.rawPayloadJson,
          lastModified: row.lastModified,
          lastSyncedAt: row.lastSyncedAt,
          ...(row.createdViaTest ? { createdViaTest: true } : {}),
        },
      }),
    ),
  );
  return rows.length;
}

export async function listMetrcHarvestsForCompany(companyId: string) {
  return prisma.metrcHarvest.findMany({
    where: { companyId },
    orderBy: [{ harvestName: "asc" }, { metrcHarvestId: "asc" }],
  });
}

export async function findMetrcHarvestByName(companyId: string, harvestName: string) {
  const trimmed = String(harvestName || "").trim();
  if (!trimmed) return null;
  const rows = await prisma.metrcHarvest.findMany({ where: { companyId } });
  const lower = trimmed.toLowerCase();
  return rows.find((r) => r.harvestName.trim().toLowerCase() === lower) ?? null;
}

export async function appendMetrcHarvestRequestLog(input: {
  companyId: string;
  action: string;
  method: string;
  endpoint: string;
  httpStatus: number | null;
  requestPayload: unknown;
  responsePayload: unknown;
  durationMs: number | null;
  actorUserId: string | null;
}): Promise<void> {
  await prisma.metrcHarvestRequestLog.create({
    data: {
      companyId: input.companyId,
      action: input.action,
      method: input.method,
      endpoint: input.endpoint,
      httpStatus: input.httpStatus,
      requestPayloadJson: JSON.stringify(input.requestPayload ?? {}),
      responsePayloadJson: JSON.stringify(input.responsePayload ?? {}),
      durationMs: input.durationMs,
      actorUserId: input.actorUserId,
    },
  });
}

export async function listMetrcHarvestRequestLogs(companyId: string, limit = 50) {
  return prisma.metrcHarvestRequestLog.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
