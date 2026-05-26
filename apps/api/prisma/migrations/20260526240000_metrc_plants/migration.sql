-- CreateTable
CREATE TABLE "MetrcPlant" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "metrcPlantId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "licenseNumber" TEXT NOT NULL DEFAULT '',
    "sourcePlantBatchId" TEXT NOT NULL DEFAULT '',
    "sourcePlantBatchName" TEXT NOT NULL DEFAULT '',
    "strainName" TEXT NOT NULL DEFAULT '',
    "growthPhase" TEXT NOT NULL DEFAULT '',
    "metrcLocationId" TEXT NOT NULL DEFAULT '',
    "locationName" TEXT NOT NULL DEFAULT '',
    "plantedDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "rawPayloadJson" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetrcPlant_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "MetrcHarvest" ADD COLUMN "sourcePlantLabelsJson" TEXT NOT NULL DEFAULT '[]';

-- CreateIndex
CREATE UNIQUE INDEX "MetrcPlant_companyId_label_key" ON "MetrcPlant"("companyId", "label");

-- CreateIndex
CREATE INDEX "MetrcPlant_companyId_licenseNumber_idx" ON "MetrcPlant"("companyId", "licenseNumber");

-- CreateIndex
CREATE INDEX "MetrcPlant_companyId_sourcePlantBatchId_idx" ON "MetrcPlant"("companyId", "sourcePlantBatchId");

-- CreateIndex
CREATE INDEX "MetrcPlant_companyId_sourcePlantBatchName_idx" ON "MetrcPlant"("companyId", "sourcePlantBatchName");

-- AddForeignKey
ALTER TABLE "MetrcPlant" ADD CONSTRAINT "MetrcPlant_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
