-- Analytics / workflow read performance indexes (NexBatch API perf branch).

CREATE INDEX "CultivationBatch_companyId_updatedAt_idx" ON "CultivationBatch"("companyId", "updatedAt");

CREATE INDEX "ExtractionRun_companyId_createdAt_idx" ON "ExtractionRun"("companyId", "createdAt");
CREATE INDEX "ExtractionRun_companyId_finishedAt_idx" ON "ExtractionRun"("companyId", "finishedAt");

CREATE INDEX "PackagingLot_companyId_createdAt_idx" ON "PackagingLot"("companyId", "createdAt");
CREATE INDEX "PackagingLot_companyId_finishedAt_idx" ON "PackagingLot"("companyId", "finishedAt");

CREATE INDEX "EdibleBatch_companyId_createdAt_idx" ON "EdibleBatch"("companyId", "createdAt");

CREATE INDEX "EdibleTaskLog_companyId_completedAt_idx" ON "EdibleTaskLog"("companyId", "completedAt");
CREATE INDEX "EdibleTaskLog_edibleBatchId_completedAt_idx" ON "EdibleTaskLog"("edibleBatchId", "completedAt");

CREATE INDEX "LaborEntry_companyId_createdAt_idx" ON "LaborEntry"("companyId", "createdAt");
CREATE INDEX "LaborEntry_companyId_stage_createdAt_idx" ON "LaborEntry"("companyId", "stage", "createdAt");

CREATE INDEX "TaskLog_companyId_stage_createdAt_idx" ON "TaskLog"("companyId", "stage", "createdAt");
