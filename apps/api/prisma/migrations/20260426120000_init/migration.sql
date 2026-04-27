-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('OWNER', 'ADMIN', 'OPERATIONS_MANAGER', 'CULTIVATION_SPECIALIST', 'EXTRACTION_SPECIALIST', 'PACKAGING_SPECIALIST', 'FINANCIAL_ANALYST', 'DATABASE_ARCHITECT', 'FULL_STACK_DEVELOPER', 'QA_TESTER', 'VIEW_ONLY');

-- CreateEnum
CREATE TYPE "public"."WorkflowStage" AS ENUM ('CULTIVATION', 'EXTRACTION', 'PACKAGING');

-- CreateEnum
CREATE TYPE "public"."CultivationAutoStatus" AS ENUM ('OPEN', 'AUTO_COMPLETED');

-- CreateEnum
CREATE TYPE "public"."SourceMaterialRole" AS ENUM ('A_GRADE_FLOWER', 'POPCORN', 'DRY_TRIM', 'FRESH_FROZEN');

-- CreateEnum
CREATE TYPE "public"."ExtractionSourceType" AS ENUM ('DRY_TRIM', 'FRESH_FROZEN');

-- CreateEnum
CREATE TYPE "public"."ExtractionProductCategory" AS ENUM ('CURED_WAX', 'LIVE');

-- CreateEnum
CREATE TYPE "public"."ExtractionPhase" AS ENUM ('PENDING_BIOMASS_PREP', 'BIOMASS_PREP_ACTIVE', 'READY_FOR_PROCESSING', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "public"."PackagingRunStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "public"."CultivationPackagingLine" AS ENUM ('A_GRADE_FLOWER', 'POPCORN');

-- CreateTable
CREATE TABLE "public"."Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nextChainSequence" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "public"."UserRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SourceChain" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cultivationBatchId" TEXT NOT NULL,
    "chainKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceChain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SourcePackage" (
    "id" TEXT NOT NULL,
    "sourceChainId" TEXT NOT NULL,
    "role" "public"."SourceMaterialRole" NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourcePackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TrimFlowState" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cultivationBatchId" TEXT NOT NULL,
    "toExtractionGrams" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "consumedGrams" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrimFlowState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FreshFrozenAllocation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cultivationBatchId" TEXT NOT NULL,
    "toExtractionGrams" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastExtractionRunId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FreshFrozenAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CultivationBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "strain" TEXT NOT NULL,
    "strainAcronym" TEXT NOT NULL,
    "batchChainCode" TEXT NOT NULL,
    "plantedAt" TIMESTAMP(3) NOT NULL,
    "expectedYieldGrams" DOUBLE PRECISION NOT NULL,
    "aGradeFlowerGrams" DOUBLE PRECISION NOT NULL,
    "popcornGrams" DOUBLE PRECISION NOT NULL,
    "trimGrams" DOUBLE PRECISION NOT NULL,
    "freshFrozenGrams" DOUBLE PRECISION NOT NULL,
    "autoStatus" "public"."CultivationAutoStatus" NOT NULL DEFAULT 'OPEN',
    "autoCompletedAt" TIMESTAMP(3),
    "room" TEXT,
    "bay" TEXT,
    "table" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CultivationBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CultivationPackagingRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cultivationBatchId" TEXT NOT NULL,
    "line" "public"."CultivationPackagingLine" NOT NULL,
    "status" "public"."PackagingRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "terpeneGramsCumulative" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netMaterialGramsInProgress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netMaterialGramsCompleted" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CultivationPackagingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PackagingWeighSession" (
    "id" TEXT NOT NULL,
    "packagingRunId" TEXT NOT NULL,
    "netProductGrams" DOUBLE PRECISION NOT NULL,
    "terpeneGrams" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackagingWeighSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ExtractionRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cultivationBatchId" TEXT NOT NULL,
    "phase" "public"."ExtractionPhase" NOT NULL DEFAULT 'PENDING_BIOMASS_PREP',
    "productCategory" "public"."ExtractionProductCategory",
    "biomassPrepStartedAt" TIMESTAMP(3),
    "socksStartAt" TIMESTAMP(3),
    "socksEndAt" TIMESTAMP(3),
    "biomassPrepDurationSeconds" INTEGER,
    "method" TEXT NOT NULL DEFAULT '',
    "inputGrams" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outputGrams" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "supplyUsed" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ExtractionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ExtractionBiomassInput" (
    "id" TEXT NOT NULL,
    "extractionRunId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cultivationBatchId" TEXT NOT NULL,
    "sourceType" "public"."ExtractionSourceType" NOT NULL,
    "grams" DOUBLE PRECISION NOT NULL,
    "sockWeightGrams" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractionBiomassInput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PackagingLot" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "extractionRunId" TEXT NOT NULL,
    "status" "public"."PackagingRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "netOutputGrams" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "terpeneGrams" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sku" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 0,
    "gramsPerUnit" DOUBLE PRECISION NOT NULL,
    "defaultTemplate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "PackagingLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LaborEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stage" "public"."WorkflowStage" NOT NULL,
    "taskType" TEXT NOT NULL DEFAULT 'OPERATIONAL',
    "hours" DOUBLE PRECISION NOT NULL,
    "hourlyRate" DOUBLE PRECISION NOT NULL,
    "totalCost" DOUBLE PRECISION NOT NULL,
    "referenceId" TEXT,
    "cultivationBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LaborEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CpuSnapshot" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "totalLabor" DOUBLE PRECISION NOT NULL,
    "totalOutputG" DOUBLE PRECISION NOT NULL,
    "cpuPerGram" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CpuSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TaskLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "stage" "public"."WorkflowStage" NOT NULL,
    "note" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CompanyConfig" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CompanyStore" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT 'legacy_frontend_store',
    "valueJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyStore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InviteToken" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "public"."UserRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InviteToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_slug_key" ON "public"."Company"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE INDEX "User_companyId_idx" ON "public"."User"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceChain_cultivationBatchId_key" ON "public"."SourceChain"("cultivationBatchId");

-- CreateIndex
CREATE INDEX "SourceChain_companyId_idx" ON "public"."SourceChain"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceChain_companyId_chainKey_key" ON "public"."SourceChain"("companyId", "chainKey");

-- CreateIndex
CREATE INDEX "SourcePackage_sourceChainId_idx" ON "public"."SourcePackage"("sourceChainId");

-- CreateIndex
CREATE UNIQUE INDEX "SourcePackage_sourceChainId_role_key" ON "public"."SourcePackage"("sourceChainId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "TrimFlowState_cultivationBatchId_key" ON "public"."TrimFlowState"("cultivationBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "FreshFrozenAllocation_cultivationBatchId_key" ON "public"."FreshFrozenAllocation"("cultivationBatchId");

-- CreateIndex
CREATE INDEX "CultivationBatch_companyId_idx" ON "public"."CultivationBatch"("companyId");

-- CreateIndex
CREATE INDEX "CultivationBatch_autoStatus_idx" ON "public"."CultivationBatch"("autoStatus");

-- CreateIndex
CREATE INDEX "CultivationPackagingRun_companyId_cultivationBatchId_line_s_idx" ON "public"."CultivationPackagingRun"("companyId", "cultivationBatchId", "line", "status");

-- CreateIndex
CREATE INDEX "PackagingWeighSession_packagingRunId_createdAt_idx" ON "public"."PackagingWeighSession"("packagingRunId", "createdAt");

-- CreateIndex
CREATE INDEX "ExtractionRun_companyId_phase_idx" ON "public"."ExtractionRun"("companyId", "phase");

-- CreateIndex
CREATE INDEX "ExtractionRun_cultivationBatchId_idx" ON "public"."ExtractionRun"("cultivationBatchId");

-- CreateIndex
CREATE INDEX "ExtractionBiomassInput_extractionRunId_cultivationBatchId_idx" ON "public"."ExtractionBiomassInput"("extractionRunId", "cultivationBatchId");

-- CreateIndex
CREATE INDEX "ExtractionBiomassInput_companyId_idx" ON "public"."ExtractionBiomassInput"("companyId");

-- CreateIndex
CREATE INDEX "PackagingLot_companyId_idx" ON "public"."PackagingLot"("companyId");

-- CreateIndex
CREATE INDEX "PackagingLot_extractionRunId_idx" ON "public"."PackagingLot"("extractionRunId");

-- CreateIndex
CREATE INDEX "PackagingLot_status_idx" ON "public"."PackagingLot"("status");

-- CreateIndex
CREATE INDEX "LaborEntry_companyId_idx" ON "public"."LaborEntry"("companyId");

-- CreateIndex
CREATE INDEX "LaborEntry_userId_idx" ON "public"."LaborEntry"("userId");

-- CreateIndex
CREATE INDEX "LaborEntry_cultivationBatchId_idx" ON "public"."LaborEntry"("cultivationBatchId");

-- CreateIndex
CREATE INDEX "CpuSnapshot_companyId_period_idx" ON "public"."CpuSnapshot"("companyId", "period");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_createdAt_idx" ON "public"."AuditLog"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskLog_companyId_createdAt_idx" ON "public"."TaskLog"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyConfig_companyId_key_key" ON "public"."CompanyConfig"("companyId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyStore_companyId_key_key" ON "public"."CompanyStore"("companyId", "key");

-- CreateIndex
CREATE INDEX "InviteToken_companyId_email_idx" ON "public"."InviteToken"("companyId", "email");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_expiresAt_idx" ON "public"."PasswordResetToken"("userId", "expiresAt");

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SourceChain" ADD CONSTRAINT "SourceChain_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SourceChain" ADD CONSTRAINT "SourceChain_cultivationBatchId_fkey" FOREIGN KEY ("cultivationBatchId") REFERENCES "public"."CultivationBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SourcePackage" ADD CONSTRAINT "SourcePackage_sourceChainId_fkey" FOREIGN KEY ("sourceChainId") REFERENCES "public"."SourceChain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TrimFlowState" ADD CONSTRAINT "TrimFlowState_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TrimFlowState" ADD CONSTRAINT "TrimFlowState_cultivationBatchId_fkey" FOREIGN KEY ("cultivationBatchId") REFERENCES "public"."CultivationBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FreshFrozenAllocation" ADD CONSTRAINT "FreshFrozenAllocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FreshFrozenAllocation" ADD CONSTRAINT "FreshFrozenAllocation_cultivationBatchId_fkey" FOREIGN KEY ("cultivationBatchId") REFERENCES "public"."CultivationBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CultivationBatch" ADD CONSTRAINT "CultivationBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CultivationPackagingRun" ADD CONSTRAINT "CultivationPackagingRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CultivationPackagingRun" ADD CONSTRAINT "CultivationPackagingRun_cultivationBatchId_fkey" FOREIGN KEY ("cultivationBatchId") REFERENCES "public"."CultivationBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PackagingWeighSession" ADD CONSTRAINT "PackagingWeighSession_packagingRunId_fkey" FOREIGN KEY ("packagingRunId") REFERENCES "public"."CultivationPackagingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExtractionRun" ADD CONSTRAINT "ExtractionRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExtractionRun" ADD CONSTRAINT "ExtractionRun_cultivationBatchId_fkey" FOREIGN KEY ("cultivationBatchId") REFERENCES "public"."CultivationBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExtractionBiomassInput" ADD CONSTRAINT "ExtractionBiomassInput_extractionRunId_fkey" FOREIGN KEY ("extractionRunId") REFERENCES "public"."ExtractionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExtractionBiomassInput" ADD CONSTRAINT "ExtractionBiomassInput_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExtractionBiomassInput" ADD CONSTRAINT "ExtractionBiomassInput_cultivationBatchId_fkey" FOREIGN KEY ("cultivationBatchId") REFERENCES "public"."CultivationBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PackagingLot" ADD CONSTRAINT "PackagingLot_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PackagingLot" ADD CONSTRAINT "PackagingLot_extractionRunId_fkey" FOREIGN KEY ("extractionRunId") REFERENCES "public"."ExtractionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LaborEntry" ADD CONSTRAINT "LaborEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LaborEntry" ADD CONSTRAINT "LaborEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CpuSnapshot" ADD CONSTRAINT "CpuSnapshot_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TaskLog" ADD CONSTRAINT "TaskLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CompanyConfig" ADD CONSTRAINT "CompanyConfig_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CompanyStore" ADD CONSTRAINT "CompanyStore_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InviteToken" ADD CONSTRAINT "InviteToken_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
