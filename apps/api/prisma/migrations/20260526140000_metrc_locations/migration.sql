-- CreateTable
CREATE TABLE "MetrcLocation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "metrcLocationId" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "locationTypeId" INTEGER,
    "locationTypeName" TEXT NOT NULL DEFAULT '',
    "forPlants" BOOLEAN NOT NULL DEFAULT false,
    "forHarvests" BOOLEAN NOT NULL DEFAULT false,
    "forPackages" BOOLEAN NOT NULL DEFAULT false,
    "rawPayloadJson" TEXT NOT NULL,
    "nexbatchRoomSuite" TEXT,
    "nexbatchRoomId" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetrcLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetrcLocation_companyId_licenseNumber_idx" ON "MetrcLocation"("companyId", "licenseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "MetrcLocation_companyId_metrcLocationId_key" ON "MetrcLocation"("companyId", "metrcLocationId");

-- AddForeignKey
ALTER TABLE "MetrcLocation" ADD CONSTRAINT "MetrcLocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
