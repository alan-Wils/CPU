import { prisma } from "../config/prisma.js";
import { OperationalWorkflowService } from "./operationalWorkflowService.js";

const operational = new OperationalWorkflowService();

export class WorkflowService {
  async createCultivation(input: {
    companyId: string;
    actorUserId: string;
    strain: string;
    strainAcronym?: string;
    plantedAt: Date;
    aGradeFlowerGrams: number;
    popcornGrams: number;
    trimGrams: number;
    freshFrozenGrams: number;
    room?: string;
    bay?: string;
    table?: string;
  }) {
    return operational.createCultivation(input);
  }

  async getOperationalState(companyId: string, batchId: string) {
    return operational.getOperationalState(companyId, batchId);
  }

  async updateCultivation(
    companyId: string,
    actorUserId: string,
    body: {
      batchId: string;
      room?: string;
      bay?: string;
      table?: string;
      plantedAt?: Date;
      complete?: boolean;
      cultivationUiState?: Record<string, unknown> | null;
    }
  ) {
    return operational.updateCultivationBatch({ companyId, actorUserId, ...body });
  }

  async deleteCultivation(companyId: string, actorUserId: string, batchId: string) {
    return operational.deleteCultivationBatch({ companyId, actorUserId, batchId });
  }

  async setTrimState(
    companyId: string,
    actorUserId: string,
    body: { batchId: string; toExtractionGrams: number; consumedGrams: number }
  ) {
    return operational.setTrimState({ companyId, actorUserId, ...body });
  }

  async setFreshFrozen(
    companyId: string,
    actorUserId: string,
    body: { batchId: string; toExtractionGrams: number; extractionRunId?: string }
  ) {
    return operational.setFreshFrozenAllocation({ companyId, actorUserId, ...body });
  }

  async listSourcePackages(companyId: string, cultivationBatchId?: string) {
    return operational.listSourcePackages({ companyId, cultivationBatchId });
  }

  async createSourcePackage(
    companyId: string,
    actorUserId: string,
    body: { cultivationBatchId: string; role: "A_GRADE_FLOWER" | "POPCORN" | "DRY_TRIM" | "FRESH_FROZEN"; canonicalName: string }
  ) {
    return operational.createSourcePackage({ companyId, actorUserId, ...body });
  }

  async updateSourcePackage(companyId: string, actorUserId: string, body: { sourcePackageId: string; canonicalName: string }) {
    return operational.updateSourcePackage({ companyId, actorUserId, ...body });
  }

  async consumeSourcePackage(companyId: string, actorUserId: string, body: { sourcePackageId: string; grams: number }) {
    return operational.consumeSourcePackage({ companyId, actorUserId, ...body });
  }

  async deleteSourcePackage(companyId: string, actorUserId: string, sourcePackageId: string) {
    return operational.deleteSourcePackage({ companyId, actorUserId, sourcePackageId });
  }

  async startCultPackaging(
    companyId: string,
    actorUserId: string,
    body: { batchId: string; line: "A_GRADE_FLOWER" | "POPCORN"; mode: "new" | "add"; openRunId?: string }
  ) {
    return operational.startCultivationPackaging({ companyId, actorUserId, ...body });
  }

  async weighCultPackaging(
    companyId: string,
    actorUserId: string,
    body: { runId: string; netProductGrams: number; terpeneGrams: number; note?: string }
  ) {
    return operational.weighCultivationPackaging({ companyId, actorUserId, ...body });
  }

  async finishCultPackaging(companyId: string, actorUserId: string, runId: string) {
    return operational.finishCultivationPackaging({ companyId, actorUserId, runId });
  }

  async createExtractionShell(companyId: string, actorUserId: string, cultivationBatchId: string) {
    return operational.createExtractionShell({ companyId, actorUserId, cultivationBatchId });
  }

  async startBiomassPrep(companyId: string, actorUserId: string, runId: string) {
    return operational.startBiomassPreparation({ companyId, actorUserId, runId });
  }

  async socksStart(companyId: string, actorUserId: string, runId: string) {
    return operational.packSocksStart({ companyId, actorUserId, runId });
  }

  async socksStop(companyId: string, actorUserId: string, runId: string) {
    return operational.packSocksStop({ companyId, actorUserId, runId });
  }

  async addExtractionBiomass(
    companyId: string,
    actorUserId: string,
    body: { runId: string; cultivationBatchId: string; sourceType: "DRY_TRIM" | "FRESH_FROZEN"; grams: number; sockWeightGrams?: number }
  ) {
    return operational.addExtractionBiomass({ companyId, actorUserId, ...body });
  }

  async sealExtractionInput(
    companyId: string,
    actorUserId: string,
    body: { runId: string; method: string; supplyUsed?: string }
  ) {
    return operational.sealProcessingInput({ companyId, actorUserId, ...body });
  }

  async completeExtraction(companyId: string, actorUserId: string, body: { runId: string; outputGrams: number }) {
    return operational.completeExtractionRun({ companyId, actorUserId, ...body });
  }

  async updateExtractionRun(
    companyId: string,
    actorUserId: string,
    body: { runId: string; method?: string; supplyUsed?: string; extractionUiState?: Record<string, unknown> | null }
  ) {
    return operational.updateExtractionRun({ companyId, actorUserId, ...body });
  }

  async deleteExtractionRun(companyId: string, actorUserId: string, runId: string) {
    return operational.deleteExtractionRun({ companyId, actorUserId, runId });
  }

  async startExtractionPackaging(
    companyId: string,
    actorUserId: string,
    body: { extractionRunId: string; sku: string; gramsPerUnit: number; defaultTemplate?: string }
  ) {
    return operational.startExtractionPackaging({ companyId, actorUserId, ...body });
  }

  async weighExtractionPackaging(
    companyId: string,
    actorUserId: string,
    body: { lotId: string; netOutputGrams: number; terpeneGrams: number }
  ) {
    return operational.weighExtractionPackaging({ companyId, actorUserId, ...body });
  }

  async finishExtractionPackaging(companyId: string, actorUserId: string, lotId: string) {
    return operational.finishExtractionPackaging({ companyId, actorUserId, lotId });
  }

  async updatePackagingLot(
    companyId: string,
    actorUserId: string,
    body: {
      lotId: string;
      sku?: string;
      gramsPerUnit?: number;
      defaultTemplate?: string;
      packagingUiState?: Record<string, unknown> | null;
    }
  ) {
    return operational.updatePackagingLot({ companyId, actorUserId, ...body });
  }

  async deletePackagingLot(companyId: string, actorUserId: string, lotId: string) {
    return operational.deletePackagingLot({ companyId, actorUserId, lotId });
  }

  /// Legacy name retained: creates extraction packaging in IN_PROGRESS; completion only via `finishExtractionPackaging`
  async createPackaging(input: {
    companyId: string;
    actorUserId: string;
    extractionRunId: string;
    sku: string;
    gramsPerUnit: number;
    defaultTemplate?: string;
  }) {
    return this.startExtractionPackaging(input.companyId, input.actorUserId, {
      extractionRunId: input.extractionRunId,
      sku: input.sku,
      gramsPerUnit: input.gramsPerUnit,
      defaultTemplate: input.defaultTemplate
    });
  }

  async listActive(companyId: string) {
    const [openCultivation, completedCultivation, extraction, packaging, cultivationPacks, biomassRemaining] =
      await Promise.all([
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
    return { cultivation, extraction, packaging, cultivationPacks, sourceMaterial: biomassRemaining };
  }

  /** Monotonic token for polling: bumps when workflow rows relevant to the SPA change. */
  async getWorkflowRevision(companyId: string) {
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
      .filter((d): d is Date => Boolean(d))
      .map((d) => d.getTime());
    const maxMs = times.length ? Math.max(...times) : 0;
    return { revision: String(maxMs) };
  }

  private async computeSourceMaterialTension(companyId: string) {
    const open = await prisma.cultivationBatch.findMany({ where: { companyId, autoStatus: "OPEN" } });
    return Promise.all(
      open.map(async (b) => {
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
      })
    );
  }
}

export { gPerPound } from "./operationalWorkflowService.js";
