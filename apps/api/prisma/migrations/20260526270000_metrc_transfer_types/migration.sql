-- CreateTable
CREATE TABLE "MetrcTransferType" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "typeCode" TEXT NOT NULL DEFAULT '',
    "licenseNumber" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'metrc',
    "rawPayloadJson" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetrcTransferType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetrcTransferType_companyId_licenseNumber_idx" ON "MetrcTransferType"("companyId", "licenseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "MetrcTransferType_companyId_name_key" ON "MetrcTransferType"("companyId", "name");

-- AddForeignKey
ALTER TABLE "MetrcTransferType" ADD CONSTRAINT "MetrcTransferType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
