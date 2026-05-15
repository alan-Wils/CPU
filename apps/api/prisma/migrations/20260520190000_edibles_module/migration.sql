-- Edibles module + UserRole / WorkflowStage extensions (PostgreSQL).

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'EDIBLES';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'EDIBLES_MANAGER';
ALTER TYPE "WorkflowStage" ADD VALUE IF NOT EXISTS 'EDIBLES';

CREATE TABLE "EdibleBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "flavor" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "stage" TEXT NOT NULL DEFAULT 'OIL_INTAKE',
    "targetMgPerPiece" DOUBLE PRECISION NOT NULL,
    "targetPieces" INTEGER NOT NULL,
    "expectedYield" INTEGER,
    "actualYield" INTEGER,
    "oilInputGrams" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalMgInput" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "wasteGrams" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "potencyMgPerGram" DOUBLE PRECISION,
    "extractionRunId" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "completedDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EdibleBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EdibleBatch_companyId_batchNumber_key" ON "EdibleBatch"("companyId", "batchNumber");
CREATE INDEX "EdibleBatch_companyId_stage_idx" ON "EdibleBatch"("companyId", "stage");
CREATE INDEX "EdibleBatch_companyId_status_idx" ON "EdibleBatch"("companyId", "status");
CREATE INDEX "EdibleBatch_extractionRunId_idx" ON "EdibleBatch"("extractionRunId");

ALTER TABLE "EdibleBatch" ADD CONSTRAINT "EdibleBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EdibleBatch" ADD CONSTRAINT "EdibleBatch_extractionRunId_fkey" FOREIGN KEY ("extractionRunId") REFERENCES "ExtractionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EdibleBatch" ADD CONSTRAINT "EdibleBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "EdibleTaskLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "edibleBatchId" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMinutes" INTEGER,
    "employees" TEXT,
    "notes" TEXT,
    "temperature" DOUBLE PRECISION,
    "weight" DOUBLE PRECISION,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EdibleTaskLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EdibleTaskLog_companyId_createdAt_idx" ON "EdibleTaskLog"("companyId", "createdAt");
CREATE INDEX "EdibleTaskLog_edibleBatchId_createdAt_idx" ON "EdibleTaskLog"("edibleBatchId", "createdAt");

ALTER TABLE "EdibleTaskLog" ADD CONSTRAINT "EdibleTaskLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EdibleTaskLog" ADD CONSTRAINT "EdibleTaskLog_edibleBatchId_fkey" FOREIGN KEY ("edibleBatchId") REFERENCES "EdibleBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EdibleTaskLog" ADD CONSTRAINT "EdibleTaskLog_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "EdibleIngredient" (
    "id" TEXT NOT NULL,
    "edibleBatchId" TEXT NOT NULL,
    "ingredientName" TEXT NOT NULL,
    "lotNumber" TEXT,
    "weight" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'g',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EdibleIngredient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EdibleIngredient_edibleBatchId_idx" ON "EdibleIngredient"("edibleBatchId");
ALTER TABLE "EdibleIngredient" ADD CONSTRAINT "EdibleIngredient_edibleBatchId_fkey" FOREIGN KEY ("edibleBatchId") REFERENCES "EdibleBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EdibleQaTest" (
    "id" TEXT NOT NULL,
    "edibleBatchId" TEXT NOT NULL,
    "potencyStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "homogeneityStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "microbialStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "failedReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "passedAt" TIMESTAMP(3),
    "notes" TEXT,
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EdibleQaTest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EdibleQaTest_edibleBatchId_createdAt_idx" ON "EdibleQaTest"("edibleBatchId", "createdAt");
ALTER TABLE "EdibleQaTest" ADD CONSTRAINT "EdibleQaTest_edibleBatchId_fkey" FOREIGN KEY ("edibleBatchId") REFERENCES "EdibleBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PackagingLot" ADD COLUMN "edibleBatchId" TEXT;
CREATE UNIQUE INDEX "PackagingLot_edibleBatchId_key" ON "PackagingLot"("edibleBatchId");
ALTER TABLE "PackagingLot" ADD CONSTRAINT "PackagingLot_edibleBatchId_fkey" FOREIGN KEY ("edibleBatchId") REFERENCES "EdibleBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
