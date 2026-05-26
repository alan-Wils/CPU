-- CreateTable
CREATE TABLE "MetrcItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "metrcItemId" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL DEFAULT '',
    "itemName" TEXT NOT NULL DEFAULT '',
    "categoryName" TEXT NOT NULL DEFAULT '',
    "unitOfMeasureName" TEXT NOT NULL DEFAULT '',
    "quantityType" TEXT NOT NULL DEFAULT '',
    "rawPayloadJson" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetrcItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetrcPackageRequestLog" (
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

    CONSTRAINT "MetrcPackageRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetrcItem_companyId_itemName_idx" ON "MetrcItem"("companyId", "itemName");

-- CreateIndex
CREATE INDEX "MetrcItem_companyId_licenseNumber_idx" ON "MetrcItem"("companyId", "licenseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "MetrcItem_companyId_metrcItemId_key" ON "MetrcItem"("companyId", "metrcItemId");

-- CreateIndex
CREATE INDEX "MetrcPackageRequestLog_companyId_createdAt_idx" ON "MetrcPackageRequestLog"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "MetrcItem" ADD CONSTRAINT "MetrcItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetrcPackageRequestLog" ADD CONSTRAINT "MetrcPackageRequestLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
