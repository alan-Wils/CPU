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
