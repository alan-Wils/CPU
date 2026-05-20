-- CreateEnum
CREATE TYPE "CultivationTransferMaterialType" AS ENUM ('FRESH_FROZEN', 'TRIM');

-- CreateEnum
CREATE TYPE "CultivationTransferStorageType" AS ENUM ('FREEZER', 'DRY_ROOM');

-- CreateEnum
CREATE TYPE "CultivationTransferStatus" AS ENUM ('READY_TO_TRANSFER', 'STORED', 'TRANSFERRED_TO_EXTRACTION');

-- CreateTable
CREATE TABLE "CultivationExtractionTransfer" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "materialType" "CultivationTransferMaterialType" NOT NULL,
    "transferStatus" "CultivationTransferStatus" NOT NULL DEFAULT 'READY_TO_TRANSFER',
    "sourceCultivationBatchId" TEXT NOT NULL,
    "sourceDryFlowerBatchId" TEXT,
    "sourceEventType" TEXT,
    "sourceEventAt" TIMESTAMP(3),
    "storageType" "CultivationTransferStorageType",
    "storageLocationId" TEXT,
    "storageLocationName" TEXT,
    "displayName" TEXT NOT NULL,
    "harvestCode" TEXT,
    "weightLbs" DOUBLE PRECISION,
    "grams" DOUBLE PRECISION,
    "bundles" INTEGER,
    "materialPayload" JSONB,
    "extractionSourceBatchId" TEXT,
    "transferredAt" TIMESTAMP(3),
    "transferredByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CultivationExtractionTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CultivationExtractionTransfer_companyId_transferStatus_idx" ON "CultivationExtractionTransfer"("companyId", "transferStatus");

-- CreateIndex
CREATE INDEX "CultivationExtractionTransfer_companyId_materialType_idx" ON "CultivationExtractionTransfer"("companyId", "materialType");

-- CreateIndex
CREATE INDEX "CultivationExtractionTransfer_companyId_sourceCultivationBatchId_idx" ON "CultivationExtractionTransfer"("companyId", "sourceCultivationBatchId");

-- AddForeignKey
ALTER TABLE "CultivationExtractionTransfer" ADD CONSTRAINT "CultivationExtractionTransfer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
