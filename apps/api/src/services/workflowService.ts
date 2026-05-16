import { prisma } from "../config/prisma.js";
import { OperationalWorkflowService } from "./operationalWorkflowService.js";
import { logDatabaseActivity } from "./usageEventRecord.js";
const operational = new OperationalWorkflowService();
export class WorkflowService {
    async createCultivation(input) {
        return operational.createCultivation(input);
    }
    async getOperationalState(companyId, batchId) {
        return operational.getOperationalState(companyId, batchId);
    }
    async updateCultivation(companyId, actorUserId, body) {
        return operational.updateCultivationBatch({ companyId, actorUserId, ...body });
    }
    async deleteCultivation(companyId, actorUserId, batchId) {
        return operational.deleteCultivationBatch({ companyId, actorUserId, batchId });
    }
    async setTrimState(companyId, actorUserId, body) {
        return operational.setTrimState({ companyId, actorUserId, ...body });
    }
    async setFreshFrozen(companyId, actorUserId, body) {
        return operational.setFreshFrozenAllocation({ companyId, actorUserId, ...body });
    }
    async listSourcePackages(companyId, cultivationBatchId) {
        return operational.listSourcePackages({ companyId, cultivationBatchId });
    }
    async createSourcePackage(companyId, actorUserId, body) {
        return operational.createSourcePackage({ companyId, actorUserId, ...body });
    }
    async updateSourcePackage(companyId, actorUserId, body) {
        return operational.updateSourcePackage({ companyId, actorUserId, ...body });
    }
    async consumeSourcePackage(companyId, actorUserId, body) {
        return operational.consumeSourcePackage({ companyId, actorUserId, ...body });
    }
    async deleteSourcePackage(companyId, actorUserId, sourcePackageId) {
        return operational.deleteSourcePackage({ companyId, actorUserId, sourcePackageId });
    }
    async startCultPackaging(companyId, actorUserId, body) {
        return operational.startCultivationPackaging({ companyId, actorUserId, ...body });
    }
    async weighCultPackaging(companyId, actorUserId, body) {
        return operational.weighCultivationPackaging({ companyId, actorUserId, ...body });
    }
    async finishCultPackaging(companyId, actorUserId, runId) {
        return operational.finishCultivationPackaging({ companyId, actorUserId, runId });
    }
    async createExtractionShell(companyId, actorUserId, cultivationBatchId) {
        return operational.createExtractionShell({ companyId, actorUserId, cultivationBatchId });
    }
    async startBiomassPrep(companyId, actorUserId, runId) {
        return operational.startBiomassPreparation({ companyId, actorUserId, runId });
    }
    async socksStart(companyId, actorUserId, runId) {
        return operational.packSocksStart({ companyId, actorUserId, runId });
    }
    async socksStop(companyId, actorUserId, runId) {
        return operational.packSocksStop({ companyId, actorUserId, runId });
    }
    async addExtractionBiomass(companyId, actorUserId, body) {
        return operational.addExtractionBiomass({ companyId, actorUserId, ...body });
    }
    async sealExtractionInput(companyId, actorUserId, body) {
        return operational.sealProcessingInput({ companyId, actorUserId, ...body });
    }
    async completeExtraction(companyId, actorUserId, body) {
        return operational.completeExtractionRun({ companyId, actorUserId, ...body });
    }
    async registerLegacyOilIntake(companyId, actorUserId, body) {
        return operational.registerLegacyCompletedOilRun({
            companyId,
            actorUserId,
            cultivationBatchId: body.cultivationBatchId,
            strain: body.strain,
            strainAcronym: body.strainAcronym,
            plantedAt: body.plantedAt,
            outputGrams: body.outputGrams,
            inputGrams: body.inputGrams,
            productType: body.productType,
            productCategory: body.productCategory,
            externalReference: body.externalReference,
            notes: body.notes,
        });
    }
    async updateExtractionRun(companyId, actorUserId, body) {
        return operational.updateExtractionRun({ companyId, actorUserId, ...body });
    }
    async deleteExtractionRun(companyId, actorUserId, runId) {
        return operational.deleteExtractionRun({ companyId, actorUserId, runId });
    }
    async startExtractionPackaging(companyId, actorUserId, body) {
        return operational.startExtractionPackaging({ companyId, actorUserId, ...body });
    }
    async weighExtractionPackaging(companyId, actorUserId, body) {
        return operational.weighExtractionPackaging({ companyId, actorUserId, ...body });
    }
    async finishExtractionPackaging(companyId, actorUserId, lotId) {
        return operational.finishExtractionPackaging({ companyId, actorUserId, lotId });
    }
    async updatePackagingLot(companyId, actorUserId, body) {
        return operational.updatePackagingLot({ companyId, actorUserId, ...body });
    }
    async deletePackagingLot(companyId, actorUserId, lotId, options) {
        return operational.deletePackagingLot({
            companyId,
            actorUserId,
            lotId,
            allowDeleteCompletedLots: options?.allowDeleteCompletedLots
        });
    }
    /// Legacy name retained: creates extraction packaging in IN_PROGRESS; completion only via `finishExtractionPackaging`
    async createPackaging(input) {
        return this.startExtractionPackaging(input.companyId, input.actorUserId, {
            extractionRunId: input.extractionRunId,
            sku: input.sku,
            gramsPerUnit: input.gramsPerUnit,
            defaultTemplate: input.defaultTemplate
        });
    }
    async listActive(companyId) {
        const [openCultivation, completedCultivation, extraction, packaging, cultivationPacks, biomassRemaining] = await Promise.all([
            prisma.cultivationBatch.findMany({
                where: { companyId, autoStatus: "OPEN" },
                orderBy: { createdAt: "desc" },
                take: 25
            }),
            prisma.cultivationBatch.findMany({
                where: { companyId, autoStatus: "AUTO_COMPLETED" },
                orderBy: [{ autoCompletedAt: "desc" }, { updatedAt: "desc" }],
                take: 25
            }),
            prisma.extractionRun.findMany({
                where: { companyId, phase: { not: "COMPLETED" } },
                orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
                take: 25
            }),
            prisma.packagingLot.findMany({
                where: { companyId, status: "IN_PROGRESS" },
                orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
                take: 25
            }),
            prisma.cultivationPackagingRun.findMany({ where: { companyId, status: "IN_PROGRESS" }, orderBy: { createdAt: "desc" }, take: 25 }),
            this.computeSourceMaterialTension(companyId)
        ]);
        const cultivation = [...openCultivation, ...completedCultivation];
        void logDatabaseActivity({
            companyId,
            feature: "workflow_list_active",
            dbReads: 1,
            rowsRead: cultivation.length + extraction.length + packaging.length + cultivationPacks.length + biomassRemaining.length,
            queryCount: 6,
            metadata: { domain: "workflow" },
        });
        return { cultivation, extraction, packaging, cultivationPacks, sourceMaterial: biomassRemaining };
    }
    /** Monotonic token for polling: bumps when workflow rows relevant to the SPA change. */
    async getWorkflowRevision(companyId) {
        const [cb, ex, pl, tl, trim, ff, cfg, legacyStore] = await Promise.all([
            prisma.cultivationBatch.aggregate({ where: { companyId }, _max: { updatedAt: true } }),
            prisma.extractionRun.aggregate({ where: { companyId }, _max: { updatedAt: true } }),
            prisma.packagingLot.aggregate({ where: { companyId }, _max: { updatedAt: true } }),
            prisma.taskLog.aggregate({ where: { companyId }, _max: { createdAt: true } }),
            prisma.trimFlowState.aggregate({ where: { companyId }, _max: { updatedAt: true } }),
            prisma.freshFrozenAllocation.aggregate({ where: { companyId }, _max: { updatedAt: true } }),
            prisma.companyConfig.aggregate({ where: { companyId }, _max: { updatedAt: true } }),
            prisma.companyStore.aggregate({ where: { companyId }, _max: { updatedAt: true } })
        ]);
        const times = [
            cb._max?.updatedAt,
            ex._max?.updatedAt,
            pl._max?.updatedAt,
            tl._max?.createdAt,
            trim._max?.updatedAt,
            ff._max?.updatedAt,
            cfg._max?.updatedAt,
            legacyStore._max?.updatedAt
        ]
            .filter((d) => Boolean(d))
            .map((d) => d.getTime());
        const maxMs = times.length ? Math.max(...times) : 0;
        void logDatabaseActivity({
            companyId,
            feature: "workflow_revision_poll",
            dbReads: 1,
            rowsRead: 8,
            queryCount: 8,
            metadata: { domain: "workflow" },
        });
        return { revision: String(maxMs) };
    }
    async computeSourceMaterialTension(companyId) {
        const open = await prisma.cultivationBatch.findMany({ where: { companyId, autoStatus: "OPEN" } });
        return Promise.all(open.map(async (b) => {
            const s = await operational.getOperationalState(companyId, b.id);
            return {
                batchId: b.id,
                strain: b.strain,
                chain: `${b.strainAcronym}-${b.batchChainCode}`,
                availableA: s.aGrade.remaining,
                availablePop: s.popcorn.remaining,
                trim: s.trim,
                fresh: s.fresh
            };
        }));
    }
}
export { gPerPound } from "./operationalWorkflowService.js";
