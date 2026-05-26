import { prisma } from "../config/prisma.js";

export type MetrcStrainUpsertRow = {
  metrcStrainId: string;
  licenseNumber: string;
  name: string;
  testingStatus: string;
  active: boolean;
  archived: boolean;
  lastModified: Date | null;
  rawPayloadJson: string;
  nexbatchStrainId: string | null;
  lastSyncedAt: Date;
};

export async function upsertMetrcStrainsForCompany(
  companyId: string,
  rows: MetrcStrainUpsertRow[],
): Promise<number> {
  if (!rows.length) return 0;
  await prisma.$transaction(
    rows.map((row) =>
      prisma.metrcStrain.upsert({
        where: {
          companyId_metrcStrainId: {
            companyId,
            metrcStrainId: row.metrcStrainId,
          },
        },
        create: {
          companyId,
          metrcStrainId: row.metrcStrainId,
          licenseNumber: row.licenseNumber,
          name: row.name,
          testingStatus: row.testingStatus,
          active: row.active,
          archived: row.archived,
          lastModified: row.lastModified,
          rawPayloadJson: row.rawPayloadJson,
          nexbatchStrainId: row.nexbatchStrainId,
          lastSyncedAt: row.lastSyncedAt,
        },
        update: {
          licenseNumber: row.licenseNumber,
          name: row.name,
          testingStatus: row.testingStatus,
          active: row.active,
          archived: row.archived,
          lastModified: row.lastModified,
          rawPayloadJson: row.rawPayloadJson,
          nexbatchStrainId: row.nexbatchStrainId,
          lastSyncedAt: row.lastSyncedAt,
        },
      }),
    ),
  );
  return rows.length;
}

export async function listMetrcStrainsForCompany(companyId: string) {
  return prisma.metrcStrain.findMany({
    where: { companyId },
    orderBy: [{ name: "asc" }, { metrcStrainId: "asc" }],
  });
}

export async function findMetrcStrainByName(
  companyId: string,
  name: string,
): Promise<{
  metrcStrainId: string;
  name: string;
  testingStatus: string;
  active: boolean;
  archived: boolean;
  licenseNumber: string;
  lastModified: Date | null;
  nexbatchStrainId: string | null;
  lastSyncedAt: Date;
} | null> {
  const trimmed = String(name || "").trim();
  if (!trimmed) return null;
  const rows = await prisma.metrcStrain.findMany({ where: { companyId } });
  const lower = trimmed.toLowerCase();
  return rows.find((r) => r.name.trim().toLowerCase() === lower) ?? null;
}

export async function appendMetrcStrainRequestLog(input: {
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
  await prisma.metrcStrainRequestLog.create({
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

export async function listMetrcStrainRequestLogs(companyId: string, limit = 50) {
  return prisma.metrcStrainRequestLog.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
