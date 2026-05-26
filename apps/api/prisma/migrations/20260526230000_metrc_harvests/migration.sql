-- CreateTable
CREATE TABLE "MetrcHarvest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "metrcHarvestId" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL DEFAULT '',
    "harvestName" TEXT NOT NULL DEFAULT '',
    "sourcePlantBatchId" TEXT NOT NULL DEFAULT '',
    "sourcePlantBatchName" TEXT NOT NULL DEFAULT '',
    "strainName" TEXT NOT NULL DEFAULT '',
    "metrcLocationId" TEXT NOT NULL DEFAULT '',
    "locationName" TEXT NOT NULL DEFAULT '',
    "harvestType" TEXT NOT NULL DEFAULT '',
    "wetWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitOfWeight" TEXT NOT NULL DEFAULT '',
    "patientLicenseNumber" TEXT NOT NULL DEFAULT '',
    "plantedDate" TIMESTAMP(3),
    "finishedDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdViaTest" BOOLEAN NOT NULL DEFAULT false,
    "rawPayloadJson" TEXT NOT NULL,
    "lastModified" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetrcHarvest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetrcHarvestRequestLog" (
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

    CONSTRAINT "MetrcHarvestRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MetrcHarvest_companyId_metrcHarvestId_key" ON "MetrcHarvest"("companyId", "metrcHarvestId");

-- CreateIndex
CREATE INDEX "MetrcHarvest_companyId_licenseNumber_idx" ON "MetrcHarvest"("companyId", "licenseNumber");

-- CreateIndex
CREATE INDEX "MetrcHarvest_companyId_harvestName_idx" ON "MetrcHarvest"("companyId", "harvestName");

-- CreateIndex
CREATE INDEX "MetrcHarvest_companyId_sourcePlantBatchId_idx" ON "MetrcHarvest"("companyId", "sourcePlantBatchId");

-- CreateIndex
CREATE INDEX "MetrcHarvestRequestLog_companyId_createdAt_idx" ON "MetrcHarvestRequestLog"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "MetrcHarvest" ADD CONSTRAINT "MetrcHarvest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetrcHarvestRequestLog" ADD CONSTRAINT "MetrcHarvestRequestLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
