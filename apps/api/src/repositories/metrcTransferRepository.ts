import { prisma } from "../config/prisma.js";

export type MetrcTransferUpsertRow = {
  metrcTransferId: string;
  direction: string;
  manifestNumber: string;
  transferType: string;
  status: string;
  licenseNumber: string;
  transporter: string;
  destinationFacility: string;
  packageLabelsJson: string;
  plannedRoute: string;
  plannedDate: Date | null;
  createdViaTest: boolean;
  rawPayloadJson: string;
  lastSyncedAt: Date;
};

export async function upsertMetrcTransfersForCompany(
  companyId: string,
  rows: MetrcTransferUpsertRow[],
): Promise<number> {
  if (!rows.length) return 0;
  await prisma.$transaction(
    rows.map((row) =>
      prisma.metrcTransfer.upsert({
        where: {
          companyId_metrcTransferId_direction: {
            companyId,
            metrcTransferId: row.metrcTransferId,
            direction: row.direction,
          },
        },
        create: {
          companyId,
          metrcTransferId: row.metrcTransferId,
          direction: row.direction,
          manifestNumber: row.manifestNumber,
          transferType: row.transferType,
          status: row.status,
          licenseNumber: row.licenseNumber,
          transporter: row.transporter,
          destinationFacility: row.destinationFacility,
          packageLabelsJson: row.packageLabelsJson,
          plannedRoute: row.plannedRoute,
          plannedDate: row.plannedDate,
          createdViaTest: row.createdViaTest,
          rawPayloadJson: row.rawPayloadJson,
          lastSyncedAt: row.lastSyncedAt,
        },
        update: {
          manifestNumber: row.manifestNumber,
          transferType: row.transferType,
          status: row.status,
          licenseNumber: row.licenseNumber,
          transporter: row.transporter,
          destinationFacility: row.destinationFacility,
          packageLabelsJson: row.packageLabelsJson,
          plannedRoute: row.plannedRoute,
          plannedDate: row.plannedDate,
          createdViaTest: row.createdViaTest,
          rawPayloadJson: row.rawPayloadJson,
          lastSyncedAt: row.lastSyncedAt,
        },
      }),
    ),
  );
  return rows.length;
}

export async function listMetrcTransfersForCompany(companyId: string) {
  return prisma.metrcTransfer.findMany({
    where: { companyId },
    orderBy: [{ lastSyncedAt: "desc" }, { manifestNumber: "asc" }],
  });
}

export async function appendMetrcTransferRequestLog(input: {
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
  await prisma.metrcTransferRequestLog.create({
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

export async function listMetrcTransferRequestLogs(companyId: string, limit = 50) {
  return prisma.metrcTransferRequestLog.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
