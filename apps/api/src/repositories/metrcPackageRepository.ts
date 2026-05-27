import { prisma } from "../config/prisma.js";

export type MetrcPackageUpsertRow = {
  packageLabel: string;
  licenseNumber: string;
  itemName: string;
  quantity: number;
  unitOfMeasure: string;
  location: string;
  productionBatchNumber: string;
  sourceHarvestNames: string;
  packagedDate: Date | null;
  expirationDate: Date | null;
  strainName: string;
  rawPayloadJson: string;
  lastSyncedAt: Date;
};

export async function upsertMetrcPackagesForCompany(
  companyId: string,
  rows: MetrcPackageUpsertRow[],
): Promise<number> {
  if (!rows.length) return 0;
  await prisma.$transaction(
    rows.map((row) =>
      prisma.metrcPackage.upsert({
        where: {
          companyId_packageLabel: {
            companyId,
            packageLabel: row.packageLabel,
          },
        },
        create: {
          companyId,
          packageLabel: row.packageLabel,
          licenseNumber: row.licenseNumber,
          itemName: row.itemName,
          quantity: row.quantity,
          unitOfMeasure: row.unitOfMeasure,
          location: row.location,
          productionBatchNumber: row.productionBatchNumber,
          sourceHarvestNames: row.sourceHarvestNames,
          packagedDate: row.packagedDate,
          expirationDate: row.expirationDate,
          strainName: row.strainName,
          rawPayloadJson: row.rawPayloadJson,
          lastSyncedAt: row.lastSyncedAt,
        },
        update: {
          licenseNumber: row.licenseNumber,
          itemName: row.itemName,
          quantity: row.quantity,
          unitOfMeasure: row.unitOfMeasure,
          location: row.location,
          productionBatchNumber: row.productionBatchNumber,
          sourceHarvestNames: row.sourceHarvestNames,
          packagedDate: row.packagedDate,
          expirationDate: row.expirationDate,
          strainName: row.strainName,
          rawPayloadJson: row.rawPayloadJson,
          lastSyncedAt: row.lastSyncedAt,
        },
      }),
    ),
  );
  return rows.length;
}

export async function listMetrcPackagesForCompany(companyId: string) {
  return prisma.metrcPackage.findMany({
    where: { companyId },
    orderBy: [{ lastSyncedAt: "desc" }, { packageLabel: "desc" }],
  });
}

export async function findMetrcPackageByLabel(companyId: string, packageLabel: string) {
  const label = String(packageLabel || "").trim();
  if (!label) return null;
  return prisma.metrcPackage.findUnique({
    where: {
      companyId_packageLabel: { companyId, packageLabel: label },
    },
  });
}

export async function appendMetrcPackageRequestLog(input: {
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
  await prisma.metrcPackageRequestLog.create({
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

export async function listMetrcPackageRequestLogs(companyId: string, limit = 50) {
  return prisma.metrcPackageRequestLog.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
