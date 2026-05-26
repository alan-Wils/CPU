-- CreateTable
CREATE TABLE "MetrcFacility" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "facilityName" TEXT NOT NULL DEFAULT '',
    "facilityType" TEXT NOT NULL DEFAULT '',
    "stateCode" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "capabilitiesJson" TEXT NOT NULL DEFAULT '[]',
    "rawPayloadJson" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetrcFacility_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetrcFacility_companyId_active_idx" ON "MetrcFacility"("companyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "MetrcFacility_companyId_licenseNumber_key" ON "MetrcFacility"("companyId", "licenseNumber");

-- AddForeignKey
ALTER TABLE "MetrcFacility" ADD CONSTRAINT "MetrcFacility_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
