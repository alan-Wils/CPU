-- AlterTable
ALTER TABLE "CultivationExtractionTransfer" ADD COLUMN "metrcTag" TEXT;
ALTER TABLE "CultivationExtractionTransfer" ADD COLUMN "parentGroupId" TEXT;

-- CreateIndex
CREATE INDEX "CultivationExtractionTransfer_companyId_parentGroupId_idx" ON "CultivationExtractionTransfer"("companyId", "parentGroupId");
