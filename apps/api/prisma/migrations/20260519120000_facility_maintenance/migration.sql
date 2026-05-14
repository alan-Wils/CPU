-- Facility maintenance module + FACILITY_MAINTENANCE_SPECIALIST role.

ALTER TYPE "UserRole" ADD VALUE 'FACILITY_MAINTENANCE_SPECIALIST';

CREATE TABLE "FacilityProfile" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "facilityName" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "cityStateZip" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "facilitySizeSqFt" INTEGER NOT NULL,
    "builtYear" INTEGER NOT NULL,
    "roomCountsJson" JSONB NOT NULL,
    "mtdTotalCost" DOUBLE PRECISION NOT NULL,
    "mtdCostSeriesJson" JSONB NOT NULL,
    "kpiSnapshotJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacilityProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FacilityProfile_companyId_key" ON "FacilityProfile"("companyId");

ALTER TABLE "FacilityProfile" ADD CONSTRAINT "FacilityProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FacilityWorkOrder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "assignedTo" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "dueMeta" TEXT,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacilityWorkOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FacilityWorkOrder_companyId_externalId_key" ON "FacilityWorkOrder"("companyId", "externalId");
CREATE INDEX "FacilityWorkOrder_companyId_status_idx" ON "FacilityWorkOrder"("companyId", "status");

ALTER TABLE "FacilityWorkOrder" ADD CONSTRAINT "FacilityWorkOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FacilityAlert" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "locationLabel" TEXT NOT NULL,
    "valueLabel" TEXT,
    "statusLabel" TEXT,
    "timeLabel" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacilityAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FacilityAlert_companyId_sortOrder_idx" ON "FacilityAlert"("companyId", "sortOrder");

ALTER TABLE "FacilityAlert" ADD CONSTRAINT "FacilityAlert_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FacilitySystemStatus" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FacilitySystemStatus_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FacilitySystemStatus_companyId_sortOrder_idx" ON "FacilitySystemStatus"("companyId", "sortOrder");

ALTER TABLE "FacilitySystemStatus" ADD CONSTRAINT "FacilitySystemStatus_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FacilityEnvironmentalReading" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "valueDisplay" TEXT NOT NULL,
    "idealRangeDisplay" TEXT NOT NULL,
    "sparklineJson" JSONB NOT NULL,
    "statusLabel" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FacilityEnvironmentalReading_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FacilityEnvironmentalReading_companyId_sortOrder_idx" ON "FacilityEnvironmentalReading"("companyId", "sortOrder");

ALTER TABLE "FacilityEnvironmentalReading" ADD CONSTRAINT "FacilityEnvironmentalReading_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FacilityCalendarEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacilityCalendarEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FacilityCalendarEvent_companyId_yearMonth_idx" ON "FacilityCalendarEvent"("companyId", "yearMonth");

ALTER TABLE "FacilityCalendarEvent" ADD CONSTRAINT "FacilityCalendarEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FacilityPreventiveMaintenanceTask" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "taskName" TEXT NOT NULL,
    "assetSystem" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "assignedTo" TEXT NOT NULL,
    "nextDueDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacilityPreventiveMaintenanceTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FacilityPreventiveMaintenanceTask_companyId_idx" ON "FacilityPreventiveMaintenanceTask"("companyId");

ALTER TABLE "FacilityPreventiveMaintenanceTask" ADD CONSTRAINT "FacilityPreventiveMaintenanceTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FacilityAsset" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assetName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "installDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacilityAsset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FacilityAsset_companyId_idx" ON "FacilityAsset"("companyId");

ALTER TABLE "FacilityAsset" ADD CONSTRAINT "FacilityAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FacilityPartRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "partName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "neededFor" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacilityPartRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FacilityPartRequest_companyId_idx" ON "FacilityPartRequest"("companyId");

ALTER TABLE "FacilityPartRequest" ADD CONSTRAINT "FacilityPartRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FacilityLocation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "locationName" TEXT NOT NULL,
    "locationType" TEXT NOT NULL,
    "parentArea" TEXT NOT NULL,
    "sqFt" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacilityLocation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FacilityLocation_companyId_idx" ON "FacilityLocation"("companyId");

ALTER TABLE "FacilityLocation" ADD CONSTRAINT "FacilityLocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
