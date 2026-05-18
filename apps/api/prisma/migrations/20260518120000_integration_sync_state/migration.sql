-- CreateTable
CREATE TABLE "IntegrationSyncState" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "cursorJson" TEXT,
    "lockStartedAt" TIMESTAMP(3),
    "lockOwner" TEXT,
    "lastMode" TEXT,
    "lastPagesPulled" INTEGER,
    "lastRowsPersisted" INTEGER,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationSyncState_companyId_provider_idx" ON "IntegrationSyncState"("companyId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationSyncState_companyId_provider_resource_key" ON "IntegrationSyncState"("companyId", "provider", "resource");

-- AddForeignKey
ALTER TABLE "IntegrationSyncState" ADD CONSTRAINT "IntegrationSyncState_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
