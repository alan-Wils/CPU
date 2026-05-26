-- CreateTable
CREATE TABLE "MetrcTransfer" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "metrcTransferId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "manifestNumber" TEXT NOT NULL DEFAULT '',
    "transferType" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "licenseNumber" TEXT NOT NULL DEFAULT '',
    "transporter" TEXT NOT NULL DEFAULT '',
    "destinationFacility" TEXT NOT NULL DEFAULT '',
    "packageLabelsJson" TEXT NOT NULL DEFAULT '[]',
    "plannedRoute" TEXT NOT NULL DEFAULT '',
    "plannedDate" TIMESTAMP(3),
    "createdViaTest" BOOLEAN NOT NULL DEFAULT false,
    "rawPayloadJson" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetrcTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetrcTransferRequestLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "requestPayloadJson" TEXT NOT NULL DEFAULT '{}',
    "responsePayloadJson" TEXT NOT NULL DEFAULT '{}',
    "durationMs" INTEGER,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetrcTransferRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetrcTransfer_companyId_licenseNumber_idx" ON "MetrcTransfer"("companyId", "licenseNumber");

-- CreateIndex
CREATE INDEX "MetrcTransfer_companyId_direction_idx" ON "MetrcTransfer"("companyId", "direction");

-- CreateIndex
CREATE INDEX "MetrcTransfer_companyId_manifestNumber_idx" ON "MetrcTransfer"("companyId", "manifestNumber");

-- CreateIndex
CREATE UNIQUE INDEX "MetrcTransfer_companyId_metrcTransferId_direction_key" ON "MetrcTransfer"("companyId", "metrcTransferId", "direction");

-- CreateIndex
CREATE INDEX "MetrcTransferRequestLog_companyId_createdAt_idx" ON "MetrcTransferRequestLog"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "MetrcTransfer" ADD CONSTRAINT "MetrcTransfer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetrcTransferRequestLog" ADD CONSTRAINT "MetrcTransferRequestLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
