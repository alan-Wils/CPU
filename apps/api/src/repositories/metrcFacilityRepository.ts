import { prisma } from "../config/prisma.js";

export type MetrcFacilityUpsertRow = {
  licenseNumber: string;
  facilityName: string;
  facilityType: string;
  facilityTypeName: string;
  stateCode: string;
  active: boolean;
  capabilitiesJson: string;
  rawPayloadJson: string;
  lastSyncedAt: Date;
};

export async function upsertMetrcFacilitiesForCompany(
  companyId: string,
  rows: MetrcFacilityUpsertRow[],
): Promise<number> {
  if (!rows.length) return 0;
  await prisma.$transaction(
    rows.map((row) =>
      prisma.metrcFacility.upsert({
        where: {
          companyId_licenseNumber: {
            companyId,
            licenseNumber: row.licenseNumber,
          },
        },
        create: {
          companyId,
          licenseNumber: row.licenseNumber,
          facilityName: row.facilityName,
          facilityType: row.facilityType,
          facilityTypeName: row.facilityTypeName,
          stateCode: row.stateCode,
          active: row.active,
          capabilitiesJson: row.capabilitiesJson,
          rawPayloadJson: row.rawPayloadJson,
          lastSyncedAt: row.lastSyncedAt,
        },
        update: {
          facilityName: row.facilityName,
          facilityType: row.facilityType,
          facilityTypeName: row.facilityTypeName,
          stateCode: row.stateCode,
          active: row.active,
          capabilitiesJson: row.capabilitiesJson,
          rawPayloadJson: row.rawPayloadJson,
          lastSyncedAt: row.lastSyncedAt,
        },
      }),
    ),
  );
  return rows.length;
}

export async function listMetrcFacilitiesForCompany(companyId: string) {
  return prisma.metrcFacility.findMany({
    where: { companyId },
    orderBy: [{ active: "desc" }, { licenseNumber: "asc" }],
  });
}
