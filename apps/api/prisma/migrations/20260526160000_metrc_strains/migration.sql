-- CreateTable
CREATE TABLE "MetrcStrain" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "metrcStrainId" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "testingStatus" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "lastModified" TIMESTAMP(3),
    "rawPayloadJson" TEXT NOT NULL,
    "nexbatchStrainId" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetrcStrain_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetrcStrain_companyId_licenseNumber_idx" ON "MetrcStrain"("companyId", "licenseNumber");

-- CreateIndex
CREATE INDEX "MetrcStrain_companyId_nexbatchStrainId_idx" ON "MetrcStrain"("companyId", "nexbatchStrainId");

-- CreateIndex
CREATE UNIQUE INDEX "MetrcStrain_companyId_metrcStrainId_key" ON "MetrcStrain"("companyId", "metrcStrainId");

-- AddForeignKey
ALTER TABLE "MetrcStrain" ADD CONSTRAINT "MetrcStrain_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
