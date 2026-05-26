-- CreateTable
CREATE TABLE "MetrcPlantBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "metrcPlantBatchId" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "strainName" TEXT NOT NULL DEFAULT '',
    "metrcStrainId" TEXT,
    "count" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metrcLocationId" TEXT NOT NULL DEFAULT '',
    "locationName" TEXT NOT NULL DEFAULT '',
    "plantedDate" TIMESTAMP(3),
    "lastModified" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdViaTest" BOOLEAN NOT NULL DEFAULT false,
    "rawPayloadJson" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetrcPlantBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetrcPlantBatchRequestLog" (
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

    CONSTRAINT "MetrcPlantBatchRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MetrcPlantBatch_companyId_metrcPlantBatchId_key" ON "MetrcPlantBatch"("companyId", "metrcPlantBatchId");

-- CreateIndex
CREATE INDEX "MetrcPlantBatch_companyId_licenseNumber_idx" ON "MetrcPlantBatch"("companyId", "licenseNumber");

-- CreateIndex
CREATE INDEX "MetrcPlantBatch_companyId_strainName_idx" ON "MetrcPlantBatch"("companyId", "strainName");

-- CreateIndex
CREATE INDEX "MetrcPlantBatch_companyId_name_idx" ON "MetrcPlantBatch"("companyId", "name");

-- CreateIndex
CREATE INDEX "MetrcPlantBatchRequestLog_companyId_createdAt_idx" ON "MetrcPlantBatchRequestLog"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "MetrcPlantBatch" ADD CONSTRAINT "MetrcPlantBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetrcPlantBatchRequestLog" ADD CONSTRAINT "MetrcPlantBatchRequestLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
