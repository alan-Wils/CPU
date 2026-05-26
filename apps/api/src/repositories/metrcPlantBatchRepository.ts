import { prisma } from "../config/prisma.js";

export type MetrcPlantBatchUpsertRow = {
  metrcPlantBatchId: string;
  licenseNumber: string;
  name: string;
  strainName: string;
  metrcStrainId: string | null;
  count: number;
  metrcLocationId: string;
  locationName: string;
  plantedDate: Date | null;
  lastModified: Date | null;
  active: boolean;
  createdViaTest: boolean;
  rawPayloadJson: string;
  lastSyncedAt: Date;
};

export async function upsertMetrcPlantBatchesForCompany(
  companyId: string,
  rows: MetrcPlantBatchUpsertRow[],
): Promise<number> {
  if (!rows.length) return 0;
  await prisma.$transaction(
    rows.map((row) =>
      prisma.metrcPlantBatch.upsert({
        where: {
          companyId_metrcPlantBatchId: {
            companyId,
            metrcPlantBatchId: row.metrcPlantBatchId,
          },
        },
        create: {
          companyId,
          metrcPlantBatchId: row.metrcPlantBatchId,
          licenseNumber: row.licenseNumber,
          name: row.name,
          strainName: row.strainName,
          metrcStrainId: row.metrcStrainId,
          count: row.count,
          metrcLocationId: row.metrcLocationId,
          locationName: row.locationName,
          plantedDate: row.plantedDate,
          lastModified: row.lastModified,
          active: row.active,
          createdViaTest: row.createdViaTest,
          rawPayloadJson: row.rawPayloadJson,
          lastSyncedAt: row.lastSyncedAt,
        },
        update: {
          licenseNumber: row.licenseNumber,
          name: row.name,
          strainName: row.strainName,
          metrcStrainId: row.metrcStrainId,
          count: row.count,
          metrcLocationId: row.metrcLocationId,
          locationName: row.locationName,
          plantedDate: row.plantedDate,
          lastModified: row.lastModified,
          active: row.active,
          rawPayloadJson: row.rawPayloadJson,
          lastSyncedAt: row.lastSyncedAt,
          ...(row.createdViaTest ? { createdViaTest: true } : {}),
        },
      }),
    ),
  );
  return rows.length;
}

export async function listMetrcPlantBatchesForCompany(companyId: string) {
  return prisma.metrcPlantBatch.findMany({
    where: { companyId },
    orderBy: [{ name: "asc" }],
  });
}

export async function findMetrcPlantBatchByName(
  companyId: string,
  name: string,
): Promise<{ id: string; name: string; metrcPlantBatchId: string } | null> {
  const trimmed = String(name || "").trim();
  if (!trimmed) return null;
  const rows = await prisma.metrcPlantBatch.findMany({
    where: { companyId },
    select: { id: true, name: true, metrcPlantBatchId: true },
  });
  const lower = trimmed.toLowerCase();
  return rows.find((r) => r.name.trim().toLowerCase() === lower) ?? null;
}

export async function appendMetrcPlantBatchRequestLog(input: {
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
  await prisma.metrcPlantBatchRequestLog.create({
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

export async function listMetrcPlantBatchRequestLogs(companyId: string, limit = 50) {
  return prisma.metrcPlantBatchRequestLog.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
