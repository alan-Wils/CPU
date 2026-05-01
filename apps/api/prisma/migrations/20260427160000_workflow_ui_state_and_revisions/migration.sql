-- Persist operational UI blobs and timestamps for cross-device sync / revision polling.

ALTER TABLE "CultivationBatch" ADD COLUMN "cultivationUiState" JSONB;
ALTER TABLE "CultivationBatch" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "CultivationBatch" SET "updatedAt" = "createdAt";

ALTER TABLE "ExtractionRun" ADD COLUMN "extractionUiState" JSONB;
ALTER TABLE "ExtractionRun" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "ExtractionRun" SET "updatedAt" = "createdAt";

ALTER TABLE "PackagingLot" ADD COLUMN "packagingUiState" JSONB;
ALTER TABLE "PackagingLot" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "PackagingLot" SET "updatedAt" = "createdAt";
