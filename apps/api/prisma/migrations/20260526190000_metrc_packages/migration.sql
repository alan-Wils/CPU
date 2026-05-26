-- CreateTable
CREATE TABLE "MetrcPackage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "packageLabel" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL DEFAULT '',
    "itemName" TEXT NOT NULL DEFAULT '',
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitOfMeasure" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "productionBatchNumber" TEXT NOT NULL DEFAULT '',
    "sourceHarvestNames" TEXT NOT NULL DEFAULT '',
    "packagedDate" TIMESTAMP(3),
    "expirationDate" TIMESTAMP(3),
    "strainName" TEXT NOT NULL DEFAULT '',
    "rawPayloadJson" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetrcPackage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetrcPackage_companyId_licenseNumber_idx" ON "MetrcPackage"("companyId", "licenseNumber");

-- CreateIndex
CREATE INDEX "MetrcPackage_companyId_strainName_idx" ON "MetrcPackage"("companyId", "strainName");

-- CreateIndex
CREATE INDEX "MetrcPackage_companyId_location_idx" ON "MetrcPackage"("companyId", "location");

-- CreateIndex
CREATE UNIQUE INDEX "MetrcPackage_companyId_packageLabel_key" ON "MetrcPackage"("companyId", "packageLabel");

-- AddForeignKey
ALTER TABLE "MetrcPackage" ADD CONSTRAINT "MetrcPackage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
