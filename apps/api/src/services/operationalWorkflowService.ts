import { prisma } from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { aGradePopcornAvailable, isAgriculturallyCompleteForAutoStatus, productCategoryForSource } from "../domain/cultivationStateEngine.js";
import { getExtractionOilPoolBreakdown } from "../lib/extractionOilPool.js";
import { AuditService } from "./auditService.js";
import { logDatabaseActivity } from "./usageEventRecord.js";
import { Prisma } from "@prisma/client";
const MAX_UI_JSON_BYTES = 900_000;
function assertUiJsonSize(field, value) {
    if (value === undefined)
        return;
    const s = JSON.stringify(value === null ? null : value);
    if (s.length > MAX_UI_JSON_BYTES) {
        throw new AppError(`${field} exceeds maximum size`, 400);
    }
}
const EPS = 0.0001;
const g = (n) => Number(n.toFixed(4));
const gPerLb = 453.592;
function deriveStrainAcronym(strain) {
    const parts = strain.trim().split(/\s+/).filter(Boolean);
    const raw = (parts.length ? parts : [strain])
        .map((p) => p[0] ?? "")
        .join("")
        .toUpperCase();
    if (raw.length > 0) {
        return raw.slice(0, 4);
    }
    return "X";
}
export class OperationalWorkflowService {
    audit = new AuditService();
    private trackDb(companyId: string, feature: string, mode: "read" | "write", rows = 1, metadata?: Prisma.InputJsonValue) {
        void logDatabaseActivity({
            companyId,
            feature,
            dbReads: mode === "read" ? 1 : 0,
            dbWrites: mode === "write" ? 1 : 0,
            rowsRead: mode === "read" ? Math.max(0, rows) : 0,
            rowsWritten: mode === "write" ? Math.max(0, rows) : 0,
            queryCount: 1,
            metadata,
        });
    }
    async createCultivation(input) {
        const total = g(input.aGradeFlowerGrams + input.popcornGrams + input.trimGrams + input.freshFrozenGrams);
        if (total <= 0) {
            throw new AppError("Total harvest per source must be positive", 400);
        }
        for (const v of [input.aGradeFlowerGrams, input.popcornGrams, input.trimGrams, input.freshFrozenGrams]) {
            if (v < 0) {
                throw new AppError("Source harvest buckets cannot be negative", 400);
            }
        }
        const created = await prisma.$transaction(async (tx) => {
            const company = await tx.company.update({
                where: { id: input.companyId },
                data: { nextChainSequence: { increment: 1 } }
            });
            const seq = company.nextChainSequence;
            const year = (input.plantedAt.getFullYear() % 100).toString().padStart(2, "0");
            const code = `${year}-${String(seq).padStart(4, "0")}`;
            const acronym = (input.strainAcronym && input.strainAcronym.length > 0 ? input.strainAcronym : deriveStrainAcronym(input.strain)).toUpperCase();
            const batch = await tx.cultivationBatch.create({
                data: {
                    companyId: input.companyId,
                    strain: input.strain,
                    strainAcronym: acronym,
                    batchChainCode: code,
                    plantedAt: input.plantedAt,
                    expectedYieldGrams: total,
                    aGradeFlowerGrams: g(input.aGradeFlowerGrams),
                    popcornGrams: g(input.popcornGrams),
                    trimGrams: g(input.trimGrams),
                    freshFrozenGrams: g(input.freshFrozenGrams)
                }
            });
            const chain = await tx.sourceChain.create({
                data: {
                    companyId: input.companyId,
                    cultivationBatchId: batch.id,
                    chainKey: `${acronym}-${code}`
                }
            });
            const roles = [
                { r: "A_GRADE_FLOWER" as const, name: `${acronym}-${code}-AG` },
                { r: "POPCORN" as const, name: `${acronym}-${code}-PC` },
                { r: "DRY_TRIM" as const, name: `${acronym}-${code}-DT` },
                { r: "FRESH_FROZEN" as const, name: `${acronym}-${code}-FF` }
            ];
            for (const p of roles) {
                await tx.sourcePackage.create({
                    data: {
                        sourceChainId: chain.id,
                        role: p.r,
                        canonicalName: p.name
                    }
                });
            }
            await tx.trimFlowState.create({
                data: { companyId: input.companyId, cultivationBatchId: batch.id, toExtractionGrams: 0, consumedGrams: 0 }
            });
            await tx.freshFrozenAllocation.create({
                data: { companyId: input.companyId, cultivationBatchId: batch.id, toExtractionGrams: 0 }
            });
            if (input.room) {
                await tx.cultivationBatch.update({ where: { id: batch.id }, data: { room: input.room, bay: input.bay, table: input.table } });
            }
            return batch;
        });
        await this.audit.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "cultivation.batch.create.operational",
            entityType: "CultivationBatch",
            entityId: created.id,
            after: { id: created.id, chain: `${created.strainAcronym}-${created.batchChainCode}` }
        });
        this.trackDb(input.companyId, "cultivation_batch_create", "write", 6, { domain: "workflow" });
        return created;
    }
    async getOperationalState(companyId, batchId) {
        const batch = await prisma.cultivationBatch.findFirst({ where: { companyId, id: batchId } });
        if (!batch) {
            throw new AppError("Cultivation batch not found", 404);
        }
        const [chain, cultRuns, trim, fresh] = await Promise.all([
            prisma.sourceChain.findFirst({ where: { cultivationBatchId: batchId }, include: { sourcePackages: true } }),
            prisma.cultivationPackagingRun.findMany({ where: { companyId, cultivationBatchId: batchId } }),
            prisma.trimFlowState.findUnique({ where: { cultivationBatchId: batchId } }),
            prisma.freshFrozenAllocation.findUnique({ where: { cultivationBatchId: batchId } })
        ]);
        if (!trim || !fresh) {
            throw new AppError("Trim / fresh frozen state missing for batch", 500);
        }
        const packageRows = this.sourcePackagesForDataHub(batch.strainAcronym, batch.batchChainCode, chain);
        const runsLite = cultRuns.map((r) => ({
            line: r.line,
            status: r.status,
            netMaterialGramsInProgress: r.netMaterialGramsInProgress,
            netMaterialGramsCompleted: r.netMaterialGramsCompleted
        }));
        const ap = aGradePopcornAvailable({ batch, cultRuns: runsLite });
        return {
            batch,
            sourceChain: chain,
            sourcePackages: packageRows,
            cultPackaging: cultRuns,
            trim,
            fresh,
            aGrade: ap.a,
            popcorn: ap.p
        };
    }
    sourcePackagesForDataHub(acronym, code, chain) {
        if (chain) {
            return chain.sourcePackages;
        }
        return [
            { role: "A_GRADE_FLOWER", canonicalName: `${acronym}-${code}-AG` },
            { role: "POPCORN", canonicalName: `${acronym}-${code}-PC` },
            { role: "DRY_TRIM", canonicalName: `${acronym}-${code}-DT` },
            { role: "FRESH_FROZEN", canonicalName: `${acronym}-${code}-FF` }
        ];
    }
    async setTrimState(input) {
        const batch = await prisma.cultivationBatch.findFirst({ where: { companyId: input.companyId, id: input.batchId } });
        if (!batch) {
            throw new AppError("Cultivation batch not found", 404);
        }
        if (g(input.toExtractionGrams + input.consumedGrams) - g(batch.trimGrams) > EPS) {
            throw new AppError("Trim allocation exceeds harvested trim for this chain", 400);
        }
        if (input.toExtractionGrams < 0 || input.consumedGrams < 0) {
            throw new AppError("Trim state cannot be negative", 400);
        }
        const row = await prisma.trimFlowState.update({
            where: { cultivationBatchId: input.batchId },
            data: { toExtractionGrams: g(input.toExtractionGrams), consumedGrams: g(input.consumedGrams) }
        });
        await this.audit.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "cultivation.trim.state",
            entityType: "CultivationBatch",
            entityId: input.batchId,
            after: row
        });
        await this.recomputeCultivationAutoStatus(input.companyId, input.batchId, input.actorUserId);
        return row;
    }
    async setFreshFrozenAllocation(input) {
        const batch = await prisma.cultivationBatch.findFirst({ where: { companyId: input.companyId, id: input.batchId } });
        if (!batch) {
            throw new AppError("Cultivation batch not found", 404);
        }
        if (g(input.toExtractionGrams) - g(batch.freshFrozenGrams) > EPS) {
            throw new AppError("Fresh frozen allocation exceeds harvest", 400);
        }
        if (input.toExtractionGrams < 0) {
            throw new AppError("Fresh frozen allocation cannot be negative", 400);
        }
        const row = await prisma.freshFrozenAllocation.update({
            where: { cultivationBatchId: input.batchId },
            data: { toExtractionGrams: g(input.toExtractionGrams), lastExtractionRunId: input.extractionRunId }
        });
        await this.audit.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "cultivation.freshfrozen.state",
            entityType: "CultivationBatch",
            entityId: input.batchId,
            after: row
        });
        await this.recomputeCultivationAutoStatus(input.companyId, input.batchId, input.actorUserId);
        return row;
    }
    async startCultivationPackaging(input) {
        if (input.mode === "add") {
            if (!input.openRunId) {
                throw new AppError("add mode requires an open in-progress run id", 400);
            }
            const open = await prisma.cultivationPackagingRun.findFirst({
                where: { companyId: input.companyId, id: input.openRunId, cultivationBatchId: input.batchId, status: "IN_PROGRESS" }
            });
            if (!open) {
                throw new AppError("Target packaging run is not in progress for this company", 404);
            }
            if (open.line !== input.line) {
                throw new AppError("Line mismatch for in-progress run", 400);
            }
            await this.audit.logAction({
                companyId: input.companyId,
                actorUserId: input.actorUserId,
                action: "cultivation.packaging.reopen",
                entityType: "CultivationPackagingRun",
                entityId: open.id,
                after: { id: open.id, line: open.line, mode: "add" }
            });
            return open;
        }
        const created = await prisma.cultivationPackagingRun.create({
            data: {
                companyId: input.companyId,
                cultivationBatchId: input.batchId,
                line: input.line,
                status: "IN_PROGRESS"
            }
        });
        await this.audit.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "cultivation.packaging.start",
            entityType: "CultivationPackagingRun",
            entityId: created.id,
            after: { id: created.id, line: created.line, mode: "new" }
        });
        this.trackDb(input.companyId, "cultivation_packaging_start", "write", 1, { domain: "workflow" });
        return created;
    }
    async weighCultivationPackaging(input) {
        if (input.netProductGrams < 0) {
            throw new AppError("Weigh in cannot be negative", 400);
        }
        if (input.terpeneGrams < 0) {
            throw new AppError("Terpene grams cannot be negative", 400);
        }
        const run = await prisma.cultivationPackagingRun.findFirst({ where: { companyId: input.companyId, id: input.runId } });
        if (!run || run.status !== "IN_PROGRESS") {
            throw new AppError("Cultivation packaging run not found or already finished", 400);
        }
        const batch = await prisma.cultivationBatch.findFirst({ where: { id: run.cultivationBatchId, companyId: input.companyId } });
        if (!batch) {
            throw new AppError("Cultivation batch not found for run", 404);
        }
        const allRuns = await prisma.cultivationPackagingRun.findMany({ where: { companyId: input.companyId, cultivationBatchId: run.cultivationBatchId } });
        const mapLite = allRuns.map((r) => ({
            line: r.line,
            status: r.status,
            netMaterialGramsInProgress: r.id === run.id ? g(r.netMaterialGramsInProgress + input.netProductGrams) : r.netMaterialGramsInProgress,
            netMaterialGramsCompleted: r.netMaterialGramsCompleted
        }));
        const ap = aGradePopcornAvailable({ batch, cultRuns: mapLite });
        const remaining = run.line === "A_GRADE_FLOWER" ? ap.a.remaining : ap.p.remaining;
        if (g(remaining) < -EPS) {
            throw new AppError("Weigh in exceeds remaining available for this line (terpenes excluded from cap)", 400);
        }
        const out = await prisma.$transaction(async (tx) => {
            await tx.packagingWeighSession.create({
                data: {
                    packagingRunId: run.id,
                    netProductGrams: g(input.netProductGrams),
                    terpeneGrams: g(input.terpeneGrams),
                    note: input.note
                }
            });
            return tx.cultivationPackagingRun.update({
                where: { id: run.id },
                data: {
                    netMaterialGramsInProgress: g(run.netMaterialGramsInProgress + input.netProductGrams),
                    terpeneGramsCumulative: g(run.terpeneGramsCumulative + input.terpeneGrams)
                }
            });
        });
        await this.audit.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "cultivation.packaging.weigh",
            entityType: "CultivationPackagingRun",
            entityId: run.id,
            after: { netProductGrams: input.netProductGrams, terpeneGrams: input.terpeneGrams }
        });
        this.trackDb(input.companyId, "cultivation_packaging_weigh", "write", 2, { domain: "workflow" });
        return out;
    }
    async finishCultivationPackaging(input) {
        const run = await prisma.cultivationPackagingRun.findFirst({ where: { companyId: input.companyId, id: input.runId } });
        if (!run || run.status !== "IN_PROGRESS") {
            throw new AppError("Cultivation packaging run not in progress", 400);
        }
        if (g(run.netMaterialGramsInProgress) <= 0) {
            throw new AppError("Cannot finish a packaging run with zero material packaged (Finish Package requires recorded weight)", 400);
        }
        const completed = await prisma.cultivationPackagingRun.update({
            where: { id: run.id },
            data: {
                status: "COMPLETED",
                netMaterialGramsCompleted: g(run.netMaterialGramsCompleted + run.netMaterialGramsInProgress),
                netMaterialGramsInProgress: 0,
                finishedAt: new Date()
            }
        });
        await this.audit.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "cultivation.packaging.finish",
            entityType: "CultivationPackagingRun",
            entityId: run.id,
            after: { status: "COMPLETED" }
        });
        this.trackDb(input.companyId, "cultivation_packaging_finish", "write", 1, { domain: "workflow" });
        await this.recomputeCultivationAutoStatus(input.companyId, run.cultivationBatchId, input.actorUserId);
        return completed;
    }
    async recomputeCultivationAutoStatus(companyId, batchId, actorUserId) {
        const batch = await prisma.cultivationBatch.findFirst({ where: { id: batchId, companyId } });
        if (!batch) {
            return;
        }
        const [cultRuns, trim, fresh] = await Promise.all([
            prisma.cultivationPackagingRun.findMany({ where: { companyId, cultivationBatchId: batchId } }),
            prisma.trimFlowState.findUnique({ where: { cultivationBatchId: batchId } }),
            prisma.freshFrozenAllocation.findUnique({ where: { cultivationBatchId: batchId } })
        ]);
        if (!trim || !fresh) {
            return;
        }
        const complete = isAgriculturallyCompleteForAutoStatus({
            batch,
            cultRuns: cultRuns.map((r) => ({
                line: r.line,
                status: r.status,
                netMaterialGramsInProgress: r.netMaterialGramsInProgress,
                netMaterialGramsCompleted: r.netMaterialGramsCompleted
            })),
            trim: { toExtractionGrams: trim.toExtractionGrams, consumedGrams: trim.consumedGrams },
            fresh: { toExtractionGrams: fresh.toExtractionGrams }
        });
        if (complete && batch.autoStatus !== "AUTO_COMPLETED") {
            await prisma.cultivationBatch.update({
                where: { id: batchId },
                data: { autoStatus: "AUTO_COMPLETED", autoCompletedAt: new Date() }
            });
            await this.audit.logAction({
                companyId,
                actorUserId,
                action: "cultivation.batch.autoComplete",
                entityType: "CultivationBatch",
                entityId: batchId,
                after: { autoStatus: "AUTO_COMPLETED" }
            });
        }
    }
    async createExtractionShell(input) {
        const batch = await prisma.cultivationBatch.findFirst({ where: { id: input.cultivationBatchId, companyId: input.companyId } });
        if (!batch) {
            throw new AppError("Cultivation batch not found for company", 404);
        }
        const run = await prisma.extractionRun.create({
            data: {
                companyId: input.companyId,
                cultivationBatchId: batch.id,
                phase: "PENDING_BIOMASS_PREP",
                method: ""
            }
        });
        await this.audit.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "extraction.run.createShell",
            entityType: "ExtractionRun",
            entityId: run.id,
            after: { phase: run.phase }
        });
        this.trackDb(input.companyId, "extraction_run_create_shell", "write", 1, { domain: "workflow" });
        return run;
    }
    async requireExtractionRun(companyId, id, expected) {
        const run = await prisma.extractionRun.findFirst({ where: { companyId, id } });
        if (!run) {
            throw new AppError("Extraction run not found", 404);
        }
        if (expected && run.phase !== expected) {
            throw new AppError("Extraction run is not in the required stage for this action", 400);
        }
        return run;
    }
    async startBiomassPreparation(input) {
        const run = await this.requireExtractionRun(input.companyId, input.runId, "PENDING_BIOMASS_PREP");
        const updated = await prisma.extractionRun.update({
            where: { id: run.id },
            data: { phase: "BIOMASS_PREP_ACTIVE", biomassPrepStartedAt: new Date() }
        });
        await this.audit.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "extraction.prep.start",
            entityType: "ExtractionRun",
            entityId: run.id,
            after: { phase: updated.phase }
        });
        return updated;
    }
    async packSocksStart(input) {
        const run = await this.requireExtractionRun(input.companyId, input.runId, "BIOMASS_PREP_ACTIVE");
        const updated = await prisma.extractionRun.update({
            where: { id: run.id },
            data: { socksStartAt: new Date() }
        });
        await this.audit.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "extraction.socks.start",
            entityType: "ExtractionRun",
            entityId: run.id,
            after: { socksStartAt: updated.socksStartAt }
        });
        return updated;
    }
    async packSocksStop(input) {
        const run = await this.requireExtractionRun(input.companyId, input.runId, "BIOMASS_PREP_ACTIVE");
        if (!run.socksStartAt) {
            throw new AppError("Pack socks start must be recorded before stop", 400);
        }
        if (run.socksEndAt) {
            throw new AppError("Pack socks already stopped for this run", 400);
        }
        const end = new Date();
        const durationMs = end.getTime() - run.socksStartAt.getTime();
        if (durationMs < 0) {
            throw new AppError("Invalid socks time ordering", 400);
        }
        const updated = await prisma.extractionRun.update({
            where: { id: run.id },
            data: {
                socksEndAt: end,
                biomassPrepDurationSeconds: Math.floor(durationMs / 1000),
                phase: "READY_FOR_PROCESSING"
            }
        });
        await this.audit.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "extraction.socks.stop",
            entityType: "ExtractionRun",
            entityId: run.id,
            after: { prepSeconds: updated.biomassPrepDurationSeconds, phase: updated.phase }
        });
        return updated;
    }
    async addExtractionBiomass(input) {
        const run = await this.requireExtractionRun(input.companyId, input.runId, "READY_FOR_PROCESSING");
        if (run.cultivationBatchId !== input.cultivationBatchId) {
            throw new AppError("Biomass source must be tied to the parent cultivation chain for this run", 400);
        }
        if (g(input.grams) <= 0) {
            throw new AppError("Biomass grams must be positive", 400);
        }
        const batch = await prisma.cultivationBatch.findFirst({ where: { id: input.cultivationBatchId, companyId: input.companyId } });
        if (!batch) {
            throw new AppError("Cultivation batch not found for biomass", 404);
        }
        const [trim, fresh, existingCount, liveRun] = await Promise.all([
            prisma.trimFlowState.findUnique({ where: { cultivationBatchId: batch.id } }),
            prisma.freshFrozenAllocation.findUnique({ where: { cultivationBatchId: batch.id } }),
            prisma.extractionBiomassInput.count({ where: { extractionRunId: run.id } }),
            prisma.extractionRun.findFirst({ where: { id: run.id } })
        ]);
        if (!trim || !fresh) {
            throw new AppError("Trim or fresh state missing for biomass", 500);
        }
        const category = productCategoryForSource(input.sourceType);
        if (existingCount > 0) {
            if (liveRun?.productCategory && liveRun.productCategory !== category) {
                throw new AppError("All biomass for a run must align to a single product family (Live vs Cured) per the source type gate", 400);
            }
        }
        if (input.sourceType === "DRY_TRIM") {
            const next = g(trim.toExtractionGrams + input.grams);
            if (g(next + trim.consumedGrams) - g(batch.trimGrams) > EPS) {
                throw new AppError("Dry trim would exceed the harvested trim in this source chain", 400);
            }
        }
        else {
            const next = g(fresh.toExtractionGrams + input.grams);
            if (g(next) - g(batch.freshFrozenGrams) > EPS) {
                throw new AppError("Fresh frozen would exceed the harvested amount in this source chain", 400);
            }
        }
        const created = await prisma.$transaction(async (tx) => {
            if (existingCount === 0) {
                await tx.extractionRun.update({ where: { id: run.id }, data: { productCategory: category } });
            }
            if (input.sourceType === "DRY_TRIM") {
                await tx.trimFlowState.update({
                    where: { cultivationBatchId: batch.id },
                    data: { toExtractionGrams: { increment: g(input.grams) } }
                });
            }
            else {
                await tx.freshFrozenAllocation.update({
                    where: { cultivationBatchId: batch.id },
                    data: { toExtractionGrams: { increment: g(input.grams) }, lastExtractionRunId: run.id }
                });
            }
            return tx.extractionBiomassInput.create({
                data: {
                    companyId: input.companyId,
                    extractionRunId: run.id,
                    cultivationBatchId: batch.id,
                    sourceType: input.sourceType,
                    grams: g(input.grams),
                    sockWeightGrams: input.sockWeightGrams
                }
            });
        });
        await this.audit.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "extraction.biomass.add",
            entityType: "ExtractionBiomassInput",
            entityId: created.id,
            after: { sourceType: input.sourceType, grams: input.grams, sock: input.sockWeightGrams, category: category }
        });
        this.trackDb(input.companyId, "extraction_biomass_add", "write", 3, { domain: "workflow" });
        await this.recomputeCultivationAutoStatus(input.companyId, input.cultivationBatchId, input.actorUserId);
        return created;
    }
    async sealProcessingInput(input) {
        const run = await this.requireExtractionRun(input.companyId, input.runId, "READY_FOR_PROCESSING");
        if (!run.productCategory) {
            throw new AppError("Register biomass before sealing processing input", 400);
        }
        const lines = await prisma.extractionBiomassInput.findMany({ where: { extractionRunId: run.id } });
        if (lines.length === 0) {
            throw new AppError("At least one biomass line is required before processing", 400);
        }
        if (!run.socksStartAt) {
            throw new AppError("Socks start/stop is required (Biomass Preparation before sealing processing)", 400);
        }
        if (!run.socksEndAt) {
            throw new AppError("Socks stop is required (Biomass Preparation before sealing processing)", 400);
        }
        const inputGrams = g(lines.reduce((s, l) => s + l.grams, 0));
        const updated = await prisma.extractionRun.update({
            where: { id: run.id },
            data: {
                phase: "IN_PROGRESS",
                method: input.method,
                inputGrams: inputGrams,
                supplyUsed: input.supplyUsed
            }
        });
        await this.audit.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "extraction.input.seal",
            entityType: "ExtractionRun",
            entityId: run.id,
            after: { method: input.method, inputGrams, phase: "IN_PROGRESS" }
        });
        this.trackDb(input.companyId, "extraction_input_seal", "write", 1, { domain: "workflow" });
        return updated;
    }
    async completeExtractionRun(input) {
        if (g(input.outputGrams) < 0) {
            throw new AppError("Output must be non-negative", 400);
        }
        const run = await this.requireExtractionRun(input.companyId, input.runId, "IN_PROGRESS");
        if (g(run.inputGrams) <= 0) {
            throw new AppError("Sealed input is required before completion", 400);
        }
        const out = await prisma.extractionRun.update({
            where: { id: run.id },
            data: {
                outputGrams: g(input.outputGrams),
                phase: "COMPLETED",
                finishedAt: new Date()
            }
        });
        await this.audit.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "extraction.run.complete",
            entityType: "ExtractionRun",
            entityId: run.id,
            after: { outputGrams: input.outputGrams, phase: "COMPLETED" }
        });
        this.trackDb(input.companyId, "extraction_run_complete", "write", 1, { domain: "workflow" });
        return out;
    }
    async startExtractionPackaging(input) {
        const run = await prisma.extractionRun.findFirst({ where: { companyId: input.companyId, id: input.extractionRunId } });
        if (!run) {
            throw new AppError("Extraction run not found", 404);
        }
        if (run.phase !== "COMPLETED") {
            throw new AppError("Extraction packaging is only available after the extraction run is completed with finished output", 400);
        }
        if (g(run.outputGrams) <= 0) {
            throw new AppError("Extraction output is required before packaging on this run", 400);
        }
        const lot = await prisma.packagingLot.create({
            data: {
                companyId: input.companyId,
                extractionRunId: run.id,
                sku: input.sku,
                status: "IN_PROGRESS",
                netOutputGrams: 0,
                terpeneGrams: 0,
                units: 0,
                gramsPerUnit: g(input.gramsPerUnit),
                defaultTemplate: input.defaultTemplate
            }
        });
        await this.audit.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "extraction.packaging.start",
            entityType: "PackagingLot",
            entityId: lot.id,
            after: { sku: lot.sku, status: "IN_PROGRESS" }
        });
        this.trackDb(input.companyId, "extraction_packaging_start", "write", 1, { domain: "workflow" });
        return lot;
    }
    async weighExtractionPackaging(input) {
        const lot = await prisma.packagingLot.findFirst({ where: { id: input.lotId, companyId: input.companyId } });
        if (!lot || lot.status !== "IN_PROGRESS") {
            throw new AppError("Packaging lot not in progress for company", 400);
        }
        if (g(input.netOutputGrams) < 0 || g(input.terpeneGrams) < 0) {
            throw new AppError("Weights must be non-negative", 400);
        }
        const run = await prisma.extractionRun.findFirst({ where: { id: lot.extractionRunId, companyId: input.companyId } });
        if (!run) {
            throw new AppError("Extraction run missing for lot", 404);
        }
        const newNet = g(lot.netOutputGrams + input.netOutputGrams);
        const pool = await getExtractionOilPoolBreakdown(input.companyId, run.id);
        if (!pool) {
            throw new AppError("Extraction run missing or not completed", 404);
        }
        const packagingAfterWeigh = g(pool.packagingGrams + input.netOutputGrams);
        const allocated = g(packagingAfterWeigh + pool.ediblesGrams);
        if (allocated - pool.outputGrams > EPS) {
            throw new AppError("Packaging would exceed shared oil pool (packaging + edible allocations vs extraction output; terpenes excluded from cap)", 400);
        }
        return prisma.packagingLot
            .update({
            where: { id: lot.id },
            data: { netOutputGrams: newNet, terpeneGrams: g(lot.terpeneGrams + input.terpeneGrams) }
        })
            .then(async (r) => {
            await this.audit.logAction({
                companyId: input.companyId,
                actorUserId: input.actorUserId,
                action: "extraction.packaging.weigh",
                entityType: "PackagingLot",
                entityId: r.id,
                after: { net: input.netOutputGrams, terpene: input.terpeneGrams }
            });
            this.trackDb(input.companyId, "extraction_packaging_weigh", "write", 1, { domain: "workflow" });
            return r;
        });
    }
    async finishExtractionPackaging(input) {
        const lot = await prisma.packagingLot.findFirst({ where: { id: input.lotId, companyId: input.companyId } });
        if (!lot || lot.status !== "IN_PROGRESS") {
            throw new AppError("Packaging lot not in progress for company", 400);
        }
        if (g(lot.netOutputGrams) <= 0) {
            throw new AppError("Finish package requires a recorded output weight (Finish Package task)", 400);
        }
        if (g(lot.gramsPerUnit) <= 0) {
            throw new AppError("Per-unit basis must be set before finish", 400);
        }
        const units = Math.max(0, Math.round(g(lot.netOutputGrams) / g(lot.gramsPerUnit)));
        return prisma.packagingLot
            .update({
            where: { id: lot.id },
            data: { status: "COMPLETED", units, finishedAt: new Date() }
        })
            .then(async (r) => {
            await this.audit.logAction({
                companyId: input.companyId,
                actorUserId: input.actorUserId,
                action: "extraction.packaging.finish",
                entityType: "PackagingLot",
                entityId: r.id,
                after: { status: "COMPLETED", units }
            });
            this.trackDb(input.companyId, "extraction_packaging_finish", "write", 1, { domain: "workflow" });
            return r;
        });
    }
    laborCostPerPoundForOperationalLabor(input) {
        if (g(input.pounds) < EPS) {
            return { usdPerLb: null, hoursPerLb: null };
        }
        return { usdPerLb: g(input.totalCost / input.pounds), hoursPerLb: g(input.hours / input.pounds) };
    }
    async updateCultivationBatch(input) {
        const batch = await prisma.cultivationBatch.findFirst({ where: { companyId: input.companyId, id: input.batchId } });
        if (!batch)
            throw new AppError("Cultivation batch not found", 404);
        assertUiJsonSize("cultivationUiState", input.cultivationUiState);
        const data: Record<string, unknown> = {
            room: input.room ?? batch.room,
            bay: input.bay ?? batch.bay,
            table: input.table ?? batch.table,
            plantedAt: input.plantedAt ?? batch.plantedAt,
            autoStatus: input.complete ? "AUTO_COMPLETED" : batch.autoStatus,
            autoCompletedAt: input.complete ? new Date() : batch.autoCompletedAt
        };
        if (input.cultivationUiState === null) {
            data.cultivationUiState = Prisma.DbNull;
        }
        else if (input.cultivationUiState !== undefined) {
            data.cultivationUiState = input.cultivationUiState;
        }
        const updated = await prisma.cultivationBatch.update({
            where: { id: batch.id },
            data
        });
        await this.audit.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "cultivation.batch.update",
            entityType: "CultivationBatch",
            entityId: updated.id,
            after: {
                room: updated.room,
                bay: updated.bay,
                table: updated.table,
                autoStatus: updated.autoStatus,
                autoCompletedAt: updated.autoCompletedAt,
                hasCultivationUiState: Boolean(updated.cultivationUiState)
            }
        });
        this.trackDb(input.companyId, "cultivation_batch_update", "write", 1, { domain: "workflow" });
        return updated;
    }
    async deleteCultivationBatch(input) {
        const batch = await prisma.cultivationBatch.findFirst({ where: { companyId: input.companyId, id: input.batchId } });
        if (!batch)
            throw new AppError("Cultivation batch not found", 404);
        const batchId = batch.id;
        await prisma.$transaction(async (tx) => {
            const cultRuns = await tx.cultivationPackagingRun.findMany({
                where: { companyId: input.companyId, cultivationBatchId: batchId },
                select: { id: true }
            });
            const cultRunIds = cultRuns.map((r) => r.id);
            if (cultRunIds.length > 0) {
                await tx.packagingWeighSession.deleteMany({
                    where: { packagingRunId: { in: cultRunIds } }
                });
                await tx.cultivationPackagingRun.deleteMany({
                    where: { id: { in: cultRunIds } }
                });
            }
            const exRuns = await tx.extractionRun.findMany({
                where: { companyId: input.companyId, cultivationBatchId: batchId },
                select: { id: true }
            });
            const exRunIds = exRuns.map((r) => r.id);
            if (exRunIds.length > 0) {
                await tx.packagingLot.deleteMany({
                    where: { extractionRunId: { in: exRunIds } }
                });
                // ExtractionBiomassInput rows cascade when runs are removed.
                await tx.extractionRun.deleteMany({
                    where: { id: { in: exRunIds } }
                });
            }
            await tx.extractionBiomassInput.deleteMany({
                where: { companyId: input.companyId, cultivationBatchId: batchId }
            });
            await tx.trimFlowState.deleteMany({
                where: { companyId: input.companyId, cultivationBatchId: batchId }
            });
            await tx.freshFrozenAllocation.deleteMany({
                where: { companyId: input.companyId, cultivationBatchId: batchId }
            });
            const chains = await tx.sourceChain.findMany({
                where: { companyId: input.companyId, cultivationBatchId: batchId },
                select: { id: true }
            });
            const chainIds = chains.map((c) => c.id);
            if (chainIds.length > 0) {
                await tx.sourcePackage.deleteMany({
                    where: { sourceChainId: { in: chainIds } }
                });
                await tx.sourceChain.deleteMany({
                    where: { id: { in: chainIds } }
                });
            }
            await tx.laborEntry.deleteMany({
                where: { companyId: input.companyId, cultivationBatchId: batchId }
            });
            await tx.cultivationBatch.delete({
                where: { id: batchId }
            });
        });
        await this.audit.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "cultivation.batch.delete",
            entityType: "CultivationBatch",
            entityId: batchId,
            after: {
                cascade: true,
                strain: batch.strain,
                batchChainCode: batch.batchChainCode
            }
        });
        this.trackDb(input.companyId, "cultivation_batch_delete", "write", 1, { domain: "workflow", cascade: true });
        return { ok: true };
    }
    async listSourcePackages(input) {
        return prisma.sourcePackage.findMany({
            where: {
                sourceChain: {
                    companyId: input.companyId,
                    cultivationBatchId: input.cultivationBatchId
                }
            },
            include: { sourceChain: true },
            orderBy: { createdAt: "desc" }
        });
    }
    async createSourcePackage(input) {
        const chain = await prisma.sourceChain.findFirst({
            where: { companyId: input.companyId, cultivationBatchId: input.cultivationBatchId }
        });
        if (!chain)
            throw new AppError("Source chain not found for cultivation batch", 404);
        const created = await prisma.sourcePackage.create({
            data: {
                sourceChainId: chain.id,
                role: input.role,
                canonicalName: input.canonicalName
            }
        });
        await this.audit.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "source.package.create",
            entityType: "SourcePackage",
            entityId: created.id,
            after: { role: created.role, canonicalName: created.canonicalName }
        });
        this.trackDb(input.companyId, "source_package_create", "write", 1, { domain: "workflow" });
        return created;
    }
    async updateSourcePackage(input) {
        const current = await prisma.sourcePackage.findFirst({
            where: { id: input.sourcePackageId, sourceChain: { companyId: input.companyId } }
        });
        if (!current)
            throw new AppError("Source package not found", 404);
        const updated = await prisma.sourcePackage.update({
            where: { id: current.id },
            data: { canonicalName: input.canonicalName }
        });
        await this.audit.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "source.package.update",
            entityType: "SourcePackage",
            entityId: updated.id,
            before: { canonicalName: current.canonicalName },
            after: { canonicalName: updated.canonicalName }
        });
        this.trackDb(input.companyId, "source_package_update", "write", 1, { domain: "workflow" });
        return updated;
    }
    async consumeSourcePackage(input) {
        const pack = await prisma.sourcePackage.findFirst({
            where: { id: input.sourcePackageId, sourceChain: { companyId: input.companyId } },
            include: { sourceChain: { include: { cultivationBatch: true } } }
        });
        if (!pack)
            throw new AppError("Source package not found", 404);
        if (pack.role === "DRY_TRIM") {
            const trim = await prisma.trimFlowState.findUnique({ where: { cultivationBatchId: pack.sourceChain.cultivationBatchId } });
            if (!trim)
                throw new AppError("Trim flow state missing", 500);
            const total = g(trim.toExtractionGrams + trim.consumedGrams + input.grams);
            if (total - g(pack.sourceChain.cultivationBatch.trimGrams) > EPS)
                throw new AppError("Trim consumption exceeds harvested trim", 400);
            const row = await prisma.trimFlowState.update({
                where: { cultivationBatchId: pack.sourceChain.cultivationBatchId },
                data: { consumedGrams: { increment: g(input.grams) } }
            });
            await this.audit.logAction({
                companyId: input.companyId,
                actorUserId: input.actorUserId,
                action: "source.package.consume.trim",
                entityType: "SourcePackage",
                entityId: pack.id,
                after: { consumedGrams: row.consumedGrams }
            });
            this.trackDb(input.companyId, "source_package_consume_trim", "write", 1, { domain: "workflow" });
            return row;
        }
        if (pack.role === "FRESH_FROZEN") {
            const fresh = await prisma.freshFrozenAllocation.findUnique({ where: { cultivationBatchId: pack.sourceChain.cultivationBatchId } });
            if (!fresh)
                throw new AppError("Fresh frozen state missing", 500);
            const total = g(fresh.toExtractionGrams + input.grams);
            if (total - g(pack.sourceChain.cultivationBatch.freshFrozenGrams) > EPS)
                throw new AppError("Fresh frozen consumption exceeds harvested fresh frozen", 400);
            const row = await prisma.freshFrozenAllocation.update({
                where: { cultivationBatchId: pack.sourceChain.cultivationBatchId },
                data: { toExtractionGrams: { increment: g(input.grams) } }
            });
            await this.audit.logAction({
                companyId: input.companyId,
                actorUserId: input.actorUserId,
                action: "source.package.consume.fresh",
                entityType: "SourcePackage",
                entityId: pack.id,
                after: { toExtractionGrams: row.toExtractionGrams }
            });
            this.trackDb(input.companyId, "source_package_consume_fresh", "write", 1, { domain: "workflow" });
            return row;
        }
        throw new AppError("Only DRY_TRIM and FRESH_FROZEN can be consumed through this endpoint", 400);
    }
    async deleteSourcePackage(input) {
        const pack = await prisma.sourcePackage.findFirst({
            where: { id: input.sourcePackageId, sourceChain: { companyId: input.companyId } },
            include: { sourceChain: true }
        });
        if (!pack)
            throw new AppError("Source package not found", 404);
        await prisma.sourcePackage.delete({ where: { id: pack.id } });
        await this.audit.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "source.package.delete",
            entityType: "SourcePackage",
            entityId: pack.id
        });
        this.trackDb(input.companyId, "source_package_delete", "write", 1, { domain: "workflow" });
        return { ok: true };
    }
    async updateExtractionRun(input) {
        const run = await prisma.extractionRun.findFirst({ where: { id: input.runId, companyId: input.companyId } });
        if (!run)
            throw new AppError("Extraction run not found", 404);
        assertUiJsonSize("extractionUiState", input.extractionUiState);
        const data: Record<string, unknown> = {
            method: input.method ?? run.method,
            supplyUsed: input.supplyUsed ?? run.supplyUsed
        };
        if (input.extractionUiState === null) {
            data.extractionUiState = Prisma.DbNull;
        }
        else if (input.extractionUiState !== undefined) {
            data.extractionUiState = input.extractionUiState;
        }
        const updated = await prisma.extractionRun.update({
            where: { id: run.id },
            data
        });
        await this.audit.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "extraction.run.update",
            entityType: "ExtractionRun",
            entityId: updated.id,
            after: { method: updated.method, supplyUsed: updated.supplyUsed, hasExtractionUiState: Boolean(updated.extractionUiState) }
        });
        this.trackDb(input.companyId, "extraction_run_update", "write", 1, { domain: "workflow" });
        return updated;
    }
    async deleteExtractionRun(input) {
        const run = await prisma.extractionRun.findFirst({ where: { id: input.runId, companyId: input.companyId } });
        if (!run)
            throw new AppError("Extraction run not found", 404);
        const lotCount = await prisma.packagingLot.count({ where: { extractionRunId: run.id } });
        if (lotCount > 0)
            throw new AppError("Cannot delete extraction run with packaging lots", 400);
        const edibleCount = await prisma.edibleBatch.count({ where: { extractionRunId: run.id } });
        if (edibleCount > 0)
            throw new AppError("Cannot delete extraction run linked to edible batches", 400);
        await prisma.extractionRun.delete({ where: { id: run.id } });
        await this.audit.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "extraction.run.delete",
            entityType: "ExtractionRun",
            entityId: run.id
        });
        this.trackDb(input.companyId, "extraction_run_delete", "write", 1, { domain: "workflow" });
        return { ok: true };
    }
    async updatePackagingLot(input) {
        const lot = await prisma.packagingLot.findFirst({ where: { id: input.lotId, companyId: input.companyId } });
        if (!lot)
            throw new AppError("Packaging lot not found", 404);
        if (lot.status === "COMPLETED")
            throw new AppError("Cannot edit completed packaging lot", 400);
        assertUiJsonSize("packagingUiState", input.packagingUiState);
        const data: Record<string, unknown> = {
            sku: input.sku ?? lot.sku,
            gramsPerUnit: input.gramsPerUnit ?? lot.gramsPerUnit,
            defaultTemplate: input.defaultTemplate ?? lot.defaultTemplate
        };
        if (input.packagingUiState === null) {
            data.packagingUiState = Prisma.DbNull;
        }
        else if (input.packagingUiState !== undefined) {
            data.packagingUiState = input.packagingUiState;
        }
        const updated = await prisma.packagingLot.update({
            where: { id: lot.id },
            data
        });
        await this.audit.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "packaging.lot.update",
            entityType: "PackagingLot",
            entityId: updated.id,
            after: { sku: updated.sku, gramsPerUnit: updated.gramsPerUnit, hasPackagingUiState: Boolean(updated.packagingUiState) }
        });
        this.trackDb(input.companyId, "packaging_lot_update", "write", 1, { domain: "workflow" });
        return updated;
    }
    async deletePackagingLot(input) {
        const lot = await prisma.packagingLot.findFirst({ where: { id: input.lotId, companyId: input.companyId } });
        if (!lot)
            throw new AppError("Packaging lot not found", 404);
        const allowCompleted = Boolean(input.allowDeleteCompletedLots);
        if (lot.status === "COMPLETED" && !allowCompleted)
            throw new AppError("Cannot delete completed packaging lot", 400);
        await prisma.packagingLot.delete({ where: { id: lot.id } });
        await this.audit.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "packaging.lot.delete",
            entityType: "PackagingLot",
            entityId: lot.id
        });
        this.trackDb(input.companyId, "packaging_lot_delete", "write", 1, { domain: "workflow" });
        return { ok: true };
    }
}
export const gPerPound = gPerLb;
