import { prisma } from "../config/prisma.js";

export type MetrcTransferTypeUpsertRow = {
  name: string;
  typeCode: string;
  licenseNumber: string;
  source: string;
  rawPayloadJson: string;
  lastSyncedAt: Date;
};

export async function upsertMetrcTransferTypesForCompany(
  companyId: string,
  rows: MetrcTransferTypeUpsertRow[],
): Promise<number> {
  if (!rows.length) return 0;
  await prisma.$transaction(
    rows.map((row) =>
      prisma.metrcTransferType.upsert({
        where: {
          companyId_name: {
            companyId,
            name: row.name,
          },
        },
        create: {
          companyId,
          name: row.name,
          typeCode: row.typeCode,
          licenseNumber: row.licenseNumber,
          source: row.source,
          rawPayloadJson: row.rawPayloadJson,
          lastSyncedAt: row.lastSyncedAt,
        },
        update: {
          typeCode: row.typeCode,
          licenseNumber: row.licenseNumber,
          source: row.source,
          rawPayloadJson: row.rawPayloadJson,
          lastSyncedAt: row.lastSyncedAt,
        },
      }),
    ),
  );
  return rows.length;
}

export async function listMetrcTransferTypesForCompany(companyId: string) {
  return prisma.metrcTransferType.findMany({
    where: { companyId },
    orderBy: [{ name: "asc" }],
  });
}

export async function seedFallbackTransferTypesForCompany(
  companyId: string,
  licenseNumber: string,
  names: readonly string[],
): Promise<number> {
  const existing = await listMetrcTransferTypesForCompany(companyId);
  if (existing.length > 0) return existing.length;

  const syncedAt = new Date();
  const rows: MetrcTransferTypeUpsertRow[] = names.map((name) => ({
    name,
    typeCode: name,
    licenseNumber,
    source: "fallback",
    rawPayloadJson: JSON.stringify({ Name: name, source: "nexbatch_fallback" }),
    lastSyncedAt: syncedAt,
  }));
  return upsertMetrcTransferTypesForCompany(companyId, rows);
}

export async function replaceMetrcTransferTypesForCompany(
  companyId: string,
  rows: MetrcTransferTypeUpsertRow[],
): Promise<number> {
  await prisma.$transaction([
    prisma.metrcTransferType.deleteMany({ where: { companyId } }),
    ...(rows.length
      ? rows.map((row) =>
          prisma.metrcTransferType.create({
            data: {
              companyId,
              name: row.name,
              typeCode: row.typeCode,
              licenseNumber: row.licenseNumber,
              source: row.source,
              rawPayloadJson: row.rawPayloadJson,
              lastSyncedAt: row.lastSyncedAt,
            },
          }),
        )
      : []),
  ]);
  return rows.length;
}
