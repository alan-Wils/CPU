import { prisma } from "../../config/prisma.js";
import { AppError } from "../../errors/AppError.js";
import {
  consumeReservationsForOilUse,
  isEdibleOilReservationTableMissing,
} from "../../lib/edibleOilReservations.js";
import {
  extractionRunMarketBatchCode,
  extractionRunProductTypeLabel,
  getExtractionOilPoolBreakdown,
  isLiveResinOilRun,
} from "../../lib/extractionOilPool.js";
import { AuditService } from "../../services/auditService.js";
import { WorkflowService } from "../../services/workflowService.js";

const audit = new AuditService();
const workflow = new WorkflowService();

const g = (n: number) => Number(Number(n).toFixed(4));

export const EDIBLE_STAGES = [
  "OIL_INTAKE",
  "RECIPE",
  "KITCHEN_PREP",
  "PRODUCTION",
  "CURE",
  "QA",
  "PACKAGING_TRANSFER",
  "COMPLETED",
] as const;

export const EDIBLE_PRODUCT_TYPES = ["Gummies", "Chocolates", "Syrups", "Capsules", "Tinctures"] as const;

function batchNumberForToday(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const suf = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `EB-${ymd}-${suf}`;
}

export class EdiblesService {
  async listExtractionOilOptions(companyId: string) {
    const runs = await prisma.extractionRun.findMany({
      where: { companyId, phase: "COMPLETED" },
      orderBy: { finishedAt: "desc" },
      take: 80,
      include: {
        cultivationBatch: { select: { strain: true, strainAcronym: true, batchChainCode: true } },
      },
    });
    const out = [];
    for (const run of runs) {
      if (!isLiveResinOilRun(run)) continue;
      const pool = await getExtractionOilPoolBreakdown(companyId, run.id);
      if (!pool || pool.availableGrams <= 0.0001) continue;
      const productType = extractionRunProductTypeLabel(run);
      const marketBatchCode = extractionRunMarketBatchCode(run);
      out.push({
        extractionRunId: run.id,
        availableGrams: pool.availableGrams,
        outputGrams: pool.outputGrams,
        packagingGrams: pool.packagingGrams,
        ediblesGrams: pool.ediblesGrams,
        reservedGrams: pool.reservedGrams,
        productType,
        marketBatchCode,
        strainLabel: marketBatchCode
          ? `${marketBatchCode} · ${run.cultivationBatch?.strain || productType}`
          : run.cultivationBatch
            ? `${run.cultivationBatch.strainAcronym || ""}-${run.cultivationBatch.batchChainCode} · ${run.cultivationBatch.strain}`
            : run.id,
        finishedAt: run.finishedAt?.toISOString() ?? null,
      });
    }
    return out;
  }

  /** Resolve a single completed Live Resin oil run (e.g. pasted id); includes zero-availability rows for visibility. */
  async resolveExtractionOilOption(companyId: string, extractionRunId: string) {
    const run = await prisma.extractionRun.findFirst({
      where: { id: extractionRunId, companyId },
      include: {
        cultivationBatch: { select: { strain: true, strainAcronym: true, batchChainCode: true } },
      },
    });
    if (!run) throw new AppError("Extraction run not found", 404);
    if (run.phase !== "COMPLETED") {
      throw new AppError("Only completed extraction runs can supply the edible kitchen", 400);
    }
    if (!isLiveResinOilRun(run)) {
      throw new AppError("Only Live Resin oil batches can supply the edible kitchen", 400);
    }
    const pool = await getExtractionOilPoolBreakdown(companyId, run.id);
    if (!pool) throw new AppError("Extraction run not found", 404);
    const productType = extractionRunProductTypeLabel(run);
    const marketBatchCode = extractionRunMarketBatchCode(run);
    return {
      extractionRunId: run.id,
      availableGrams: pool.availableGrams,
      outputGrams: pool.outputGrams,
      packagingGrams: pool.packagingGrams,
      ediblesGrams: pool.ediblesGrams,
      reservedGrams: pool.reservedGrams,
      productType,
      marketBatchCode,
      strainLabel: marketBatchCode
        ? `${marketBatchCode} · ${run.cultivationBatch?.strain || productType}`
        : run.cultivationBatch
          ? `${run.cultivationBatch.strainAcronym || ""}-${run.cultivationBatch.batchChainCode} · ${run.cultivationBatch.strain}`
          : run.id,
      finishedAt: run.finishedAt?.toISOString() ?? null,
    };
  }

  async listOilReservations(companyId: string) {
    const query = {
      where: { companyId, status: "ACTIVE" as const },
      orderBy: { createdAt: "desc" as const },
      take: 200,
      include: {
        extractionRun: {
          select: {
            id: true,
            extractionUiState: true,
            productCategory: true,
            cultivationBatch: { select: { strain: true } },
          },
        },
      },
    };
    let rows;
    try {
      rows = await prisma.edibleOilReservation.findMany(query);
    } catch (err) {
      if (isEdibleOilReservationTableMissing(err)) return [];
      throw err;
    }
    return rows.map((r) => {
      const marketBatchCode = extractionRunMarketBatchCode(r.extractionRun);
      const productType = extractionRunProductTypeLabel(r.extractionRun);
      return {
        id: r.id,
        extractionRunId: r.extractionRunId,
        reservedGrams: g(r.reservedGrams),
        label: r.label,
        notes: r.notes,
        status: r.status,
        extractionRunLabel: marketBatchCode
          ? `${marketBatchCode} · ${r.extractionRun.cultivationBatch?.strain || productType}`
          : r.extractionRunId,
        marketBatchCode,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }

  async createOilReservation(
    companyId: string,
    actorUserId: string,
    input: {
      extractionRunId: string;
      reservedGrams: number;
      label?: string | null;
      notes?: string | null;
    },
  ) {
    const sourceRun = await prisma.extractionRun.findFirst({
      where: { id: input.extractionRunId, companyId, phase: "COMPLETED" },
    });
    if (!sourceRun) {
      throw new AppError("Extraction run not found or not completed", 404);
    }
    if (!isLiveResinOilRun(sourceRun)) {
      throw new AppError("Only Live Resin oil batches can be reserved for the edible kitchen", 400);
    }
    const grams = g(input.reservedGrams);
    if (grams <= 0) {
      throw new AppError("Reserved grams must be greater than zero", 400);
    }
    const pool = await getExtractionOilPoolBreakdown(companyId, input.extractionRunId);
    const avail = pool?.availableGrams ?? 0;
    if (grams > g(avail + 0.0001)) {
      throw new AppError(
        `Cannot reserve ${grams} g — only ${g(avail)} g available on this extraction run (after packaging, kitchen use, and existing reservations)`,
        400,
      );
    }
    const row = await prisma.edibleOilReservation.create({
      data: {
        companyId,
        extractionRunId: input.extractionRunId,
        reservedGrams: grams,
        label: input.label?.trim() || null,
        notes: input.notes?.trim() || null,
        status: "ACTIVE",
        createdById: actorUserId,
      },
    });
    await audit.logAction({
      companyId,
      actorUserId,
      action: "edible.oil_reservation.create",
      entityType: "EdibleOilReservation",
      entityId: row.id,
      after: { extractionRunId: row.extractionRunId, reservedGrams: row.reservedGrams },
    });
    return row;
  }

  async releaseOilReservation(companyId: string, actorUserId: string, reservationId: string) {
    const existing = await prisma.edibleOilReservation.findFirst({
      where: { id: reservationId, companyId },
    });
    if (!existing) throw new AppError("Oil reservation not found", 404);
    if (existing.status !== "ACTIVE") {
      throw new AppError("Only active reservations can be released", 400);
    }
    const row = await prisma.edibleOilReservation.update({
      where: { id: reservationId },
      data: { status: "RELEASED", releasedAt: new Date() },
    });
    await audit.logAction({
      companyId,
      actorUserId,
      action: "edible.oil_reservation.release",
      entityType: "EdibleOilReservation",
      entityId: row.id,
      before: { status: existing.status, reservedGrams: existing.reservedGrams },
      after: { status: row.status },
    });
    return { ok: true };
  }

  async getDashboard(companyId: string) {
    const batches = await prisma.edibleBatch.findMany({
      where: { companyId },
      orderBy: { updatedAt: "desc" },
      take: 200,
      include: {
        extractionRun: {
          select: {
            id: true,
            outputGrams: true,
            productCategory: true,
            extractionUiState: true,
            packagingLots: { select: { id: true }, orderBy: { updatedAt: "desc" }, take: 1 },
          },
        },
        qaTests: { orderBy: { createdAt: "desc" }, take: 1 },
        packagingLot: { select: { id: true, sku: true, status: true } },
        taskLogs: { orderBy: { createdAt: "desc" }, take: 1, select: { employees: true, taskType: true } },
        _count: { select: { taskLogs: true, ingredients: true } },
      },
    });

    const activeStages = new Set(["OIL_INTAKE", "RECIPE", "KITCHEN_PREP", "PRODUCTION", "CURE"]);
    const active = batches.filter((b) => activeStages.has(b.stage) && b.status !== "CANCELLED");
    const gummiesInProduction = active
      .filter((b) => String(b.productType).toLowerCase().includes("gumm"))
      .reduce((s, b) => s + (b.targetPieces || 0), 0);
    const totalMgScheduled = g(
      active.reduce((s, b) => s + (Number(b.totalMgInput) || 0), 0),
    );
    const pendingQa = batches.filter((b) => b.stage === "QA" && b.status === "QA_PENDING").length;
    const readyPackaging = batches.filter(
      (b) => b.stage === "PACKAGING_TRANSFER" && b.status === "QA_PASSED",
    ).length;

    return {
      kpis: {
        activeBatches: active.length,
        gummiesInProduction,
        totalMgScheduled,
        pendingQa,
        readyForPackaging: readyPackaging,
      },
      batches: batches.map((b) => ({
        id: b.id,
        batchNumber: b.batchNumber,
        sku: b.sku,
        flavor: b.flavor,
        productType: b.productType,
        status: b.status,
        stage: b.stage,
        targetMgPerPiece: b.targetMgPerPiece,
        targetPieces: b.targetPieces,
        expectedYield: b.expectedYield,
        actualYield: b.actualYield,
        oilInputGrams: b.oilInputGrams,
        totalMgInput: b.totalMgInput,
        wasteGrams: b.wasteGrams,
        extractionRunId: b.extractionRunId,
        extractionRunLabel:
          extractionRunMarketBatchCode(b.extractionRun) ||
          b.extractionRun.packagingLots[0]?.id ||
          b.extractionRunId,
        notes: b.notes,
        startDate: b.startDate?.toISOString() ?? null,
        completedDate: b.completedDate?.toISOString() ?? null,
        createdAt: b.createdAt.toISOString(),
        updatedAt: b.updatedAt.toISOString(),
        taskLogCount: b._count.taskLogs,
        ingredientCount: b._count.ingredients,
        latestQa: b.qaTests[0]
          ? {
              id: b.qaTests[0].id,
              potencyStatus: b.qaTests[0].potencyStatus,
              homogeneityStatus: b.qaTests[0].homogeneityStatus,
              microbialStatus: b.qaTests[0].microbialStatus,
              passedAt: b.qaTests[0].passedAt?.toISOString() ?? null,
            }
          : null,
        packagingLotId: b.packagingLot?.id ?? null,
        lastTaskEmployees: b.taskLogs[0]?.employees?.trim() || null,
        lastTaskType: b.taskLogs[0]?.taskType ?? null,
        yieldPct:
          b.expectedYield && b.expectedYield > 0 && b.actualYield != null
            ? g((100 * b.actualYield) / b.expectedYield)
            : null,
      })),
    };
  }

  async createBatch(
    companyId: string,
    actorUserId: string,
    input: {
      sku: string;
      flavor: string;
      productType: string;
      targetMgPerPiece: number;
      targetPieces: number;
      extractionRunId: string;
      oilInputGrams: number;
      potencyMgPerGram?: number | null;
      notes?: string | null;
      expectedYield?: number | null;
    },
  ) {
    if (!EDIBLE_PRODUCT_TYPES.includes(input.productType as (typeof EDIBLE_PRODUCT_TYPES)[number])) {
      throw new AppError(`Unsupported product type: ${input.productType}`, 400);
    }
    const sourceRun = await prisma.extractionRun.findFirst({
      where: { id: input.extractionRunId, companyId, phase: "COMPLETED" },
    });
    if (!sourceRun) {
      throw new AppError("Extraction run not found or not completed", 404);
    }
    if (!isLiveResinOilRun(sourceRun)) {
      throw new AppError("Only Live Resin oil batches can supply the edible kitchen", 400);
    }
    const pool = await getExtractionOilPoolBreakdown(companyId, input.extractionRunId);
    const avail = pool?.availableGrams ?? 0;
    if (input.oilInputGrams <= 0 || g(input.oilInputGrams) > g(avail + 0.0001)) {
      throw new AppError(`Oil grams must be > 0 and ≤ available (${g(avail)} g) on this extraction run`, 400);
    }
    const potency = input.potencyMgPerGram != null ? g(Number(input.potencyMgPerGram)) : null;
    const totalMg = potency != null && potency > 0 ? g(input.oilInputGrams * potency) : 0;

    const batchNumber = batchNumberForToday();
    const row = await prisma.edibleBatch.create({
      data: {
        companyId,
        batchNumber,
        sku: input.sku.trim(),
        flavor: input.flavor.trim(),
        productType: input.productType,
        status: "ACTIVE",
        stage: "OIL_INTAKE",
        targetMgPerPiece: g(input.targetMgPerPiece),
        targetPieces: Math.floor(input.targetPieces),
        expectedYield: input.expectedYield ?? Math.floor(input.targetPieces),
        oilInputGrams: g(input.oilInputGrams),
        totalMgInput: totalMg,
        potencyMgPerGram: potency,
        extractionRunId: input.extractionRunId,
        notes: input.notes?.trim() || null,
        createdById: actorUserId,
        startDate: new Date(),
      },
    });
    await consumeReservationsForOilUse(companyId, input.extractionRunId, row.oilInputGrams);
    await audit.logAction({
      companyId,
      actorUserId,
      action: "edible.batch.create",
      entityType: "EdibleBatch",
      entityId: row.id,
      after: {
        batchNumber: row.batchNumber,
        sku: row.sku,
        stage: row.stage,
        oilInputGrams: row.oilInputGrams,
      },
    });
    return row;
  }

  async updateBatch(
    companyId: string,
    actorUserId: string,
    batchId: string,
    patch: { stage?: string; status?: string; notes?: string | null; actualYield?: number | null; wasteGrams?: number },
  ) {
    const existing = await prisma.edibleBatch.findFirst({ where: { id: batchId, companyId } });
    if (!existing) throw new AppError("Edible batch not found", 404);
    if (patch.stage && !EDIBLE_STAGES.includes(patch.stage as (typeof EDIBLE_STAGES)[number])) {
      throw new AppError("Invalid stage", 400);
    }
    const data: Record<string, unknown> = {};
    if (patch.stage !== undefined) data.stage = patch.stage;
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.notes !== undefined) data.notes = patch.notes;
    if (patch.actualYield !== undefined) data.actualYield = patch.actualYield;
    if (patch.wasteGrams !== undefined) data.wasteGrams = g(Number(patch.wasteGrams));
    if (patch.status === "COMPLETED" || patch.stage === "COMPLETED") {
      data.completedDate = new Date();
    }
    const row = await prisma.edibleBatch.update({ where: { id: batchId }, data: data as any });
    await audit.logAction({
      companyId,
      actorUserId,
      action: "edible.batch.update",
      entityType: "EdibleBatch",
      entityId: row.id,
      before: { stage: existing.stage, status: existing.status },
      after: { stage: row.stage, status: row.status },
    });
    return row;
  }

  async deleteBatch(companyId: string, actorUserId: string, batchId: string) {
    const existing = await prisma.edibleBatch.findFirst({
      where: { id: batchId, companyId },
      include: { packagingLot: true },
    });
    if (!existing) throw new AppError("Edible batch not found", 404);
    if (existing.packagingLot) {
      throw new AppError("Delete or unlink packaging lot before deleting this edible batch", 400);
    }
    await prisma.edibleBatch.delete({ where: { id: batchId } });
    await audit.logAction({
      companyId,
      actorUserId,
      action: "edible.batch.delete",
      entityType: "EdibleBatch",
      entityId: batchId,
      before: { batchNumber: existing.batchNumber },
    });
    return { ok: true };
  }

  async addTaskLog(
    companyId: string,
    actorUserId: string,
    batchId: string,
    body: {
      taskType: string;
      startedAt?: string | null;
      completedAt?: string | null;
      durationMinutes?: number | null;
      employees?: string | null;
      notes?: string | null;
      temperature?: number | null;
      weight?: number | null;
    },
  ) {
    const batch = await prisma.edibleBatch.findFirst({ where: { id: batchId, companyId } });
    if (!batch) throw new AppError("Edible batch not found", 404);
    const row = await prisma.edibleTaskLog.create({
      data: {
        companyId,
        edibleBatchId: batchId,
        taskType: body.taskType.trim(),
        startedAt: body.startedAt ? new Date(body.startedAt) : null,
        completedAt: body.completedAt ? new Date(body.completedAt) : null,
        durationMinutes: body.durationMinutes ?? null,
        employees: body.employees ?? null,
        notes: body.notes?.trim() || null,
        temperature: body.temperature ?? null,
        weight: body.weight != null ? g(body.weight) : null,
        createdById: actorUserId,
      },
    });
    await prisma.edibleBatch.update({
      where: { id: batchId },
      data: { updatedAt: new Date() },
    });
    await audit.logAction({
      companyId,
      actorUserId,
      action: "edible.task.log",
      entityType: "EdibleBatch",
      entityId: batchId,
      after: { taskType: row.taskType, taskLogId: row.id },
    });
    return row;
  }

  async addIngredient(
    companyId: string,
    actorUserId: string,
    batchId: string,
    body: { ingredientName: string; lotNumber?: string | null; weight: number; unit?: string },
  ) {
    const batch = await prisma.edibleBatch.findFirst({ where: { id: batchId, companyId } });
    if (!batch) throw new AppError("Edible batch not found", 404);
    const row = await prisma.edibleIngredient.create({
      data: {
        edibleBatchId: batchId,
        ingredientName: body.ingredientName.trim(),
        lotNumber: body.lotNumber?.trim() || null,
        weight: g(body.weight),
        unit: body.unit?.trim() || "g",
      },
    });
    await prisma.edibleBatch.update({ where: { id: batchId }, data: { updatedAt: new Date() } });
    await audit.logAction({
      companyId,
      actorUserId,
      action: "edible.ingredient.add",
      entityType: "EdibleBatch",
      entityId: batchId,
      after: { ingredientId: row.id, name: row.ingredientName },
    });
    return row;
  }

  async submitQa(
    companyId: string,
    actorUserId: string,
    batchId: string,
    body: {
      potencyStatus: string;
      homogeneityStatus: string;
      microbialStatus: string;
      failedReason?: string | null;
      notes?: string | null;
    },
  ) {
    const batch = await prisma.edibleBatch.findFirst({ where: { id: batchId, companyId } });
    if (!batch) throw new AppError("Edible batch not found", 404);
    const test = await prisma.edibleQaTest.create({
      data: {
        edibleBatchId: batchId,
        potencyStatus: body.potencyStatus,
        homogeneityStatus: body.homogeneityStatus,
        microbialStatus: body.microbialStatus,
        failedReason: body.failedReason?.trim() || null,
        notes: body.notes?.trim() || null,
        submittedAt: new Date(),
        passedAt:
          body.potencyStatus === "PASSED" &&
          body.homogeneityStatus === "PASSED" &&
          body.microbialStatus === "PASSED"
            ? new Date()
            : null,
      },
    });
    const allPass =
      body.potencyStatus === "PASSED" &&
      body.homogeneityStatus === "PASSED" &&
      body.microbialStatus === "PASSED";
    const anyFail =
      body.potencyStatus === "FAILED" ||
      body.homogeneityStatus === "FAILED" ||
      body.microbialStatus === "FAILED";
    await prisma.edibleBatch.update({
      where: { id: batchId },
      data: {
        status: anyFail ? "QA_FAILED" : allPass ? "QA_PASSED" : "QA_PENDING",
        stage: batch.stage === "QA" || batch.stage === "PRODUCTION" || batch.stage === "CURE" ? "QA" : batch.stage,
        updatedAt: new Date(),
      },
    });
    await audit.logAction({
      companyId,
      actorUserId,
      action: "edible.qa.submit",
      entityType: "EdibleBatch",
      entityId: batchId,
      after: { qaTestId: test.id, potency: test.potencyStatus },
    });
    return test;
  }

  async managerReviewQa(
    companyId: string,
    actorUserId: string,
    batchId: string,
    body: { qaTestId: string; approve: boolean; notes?: string | null; failedReason?: string | null },
  ) {
    const test = await prisma.edibleQaTest.findFirst({
      where: { id: body.qaTestId, edibleBatch: { id: batchId, companyId } },
    });
    if (!test) throw new AppError("QA test not found", 404);
    const batch = await prisma.edibleBatch.findFirst({ where: { id: batchId, companyId } });
    if (!batch) throw new AppError("Edible batch not found", 404);
    if (body.approve) {
      await prisma.edibleQaTest.update({
        where: { id: test.id },
        data: {
          passedAt: new Date(),
          notes: body.notes?.trim() || test.notes,
          reviewedById: actorUserId,
        },
      });
      await prisma.edibleBatch.update({
        where: { id: batchId },
        data: { status: "QA_PASSED", stage: "PACKAGING_TRANSFER", updatedAt: new Date() },
      });
    } else {
      await prisma.edibleQaTest.update({
        where: { id: test.id },
        data: {
          potencyStatus: "FAILED",
          failedReason: body.failedReason?.trim() || "Rejected by manager",
          notes: body.notes?.trim() || test.notes,
          reviewedById: actorUserId,
        },
      });
      await prisma.edibleBatch.update({
        where: { id: batchId },
        data: { status: "QA_FAILED", updatedAt: new Date() },
      });
    }
    await audit.logAction({
      companyId,
      actorUserId,
      action: body.approve ? "edible.qa.approve" : "edible.qa.reject",
      entityType: "EdibleBatch",
      entityId: batchId,
      after: { qaTestId: test.id },
    });
    return { ok: true };
  }

  async transferToPackaging(
    companyId: string,
    actorUserId: string,
    batchId: string,
    body: { gramsPerUnit: number; defaultTemplate?: string | null },
  ) {
    const batch = await prisma.edibleBatch.findFirst({
      where: { id: batchId, companyId },
      include: { packagingLot: true },
    });
    if (!batch) throw new AppError("Edible batch not found", 404);
    if (batch.status !== "QA_PASSED") {
      throw new AppError("Batch must have QA status QA_PASSED before packaging transfer", 400);
    }
    if (batch.packagingLot) throw new AppError("Packaging lot already linked", 400);
    const gramsPerUnit = g(body.gramsPerUnit);
    if (gramsPerUnit <= 0) throw new AppError("gramsPerUnit must be positive", 400);

    const lot = await workflow.createPackaging({
      companyId,
      actorUserId,
      extractionRunId: batch.extractionRunId,
      sku: batch.sku,
      gramsPerUnit,
      defaultTemplate: body.defaultTemplate ?? undefined,
    });
    await prisma.packagingLot.update({
      where: { id: lot.id },
      data: { edibleBatchId: batch.id },
    });
    await prisma.edibleBatch.update({
      where: { id: batch.id },
      data: {
        stage: "COMPLETED",
        status: "COMPLETED",
        completedDate: new Date(),
        actualYield: batch.actualYield ?? batch.targetPieces,
        updatedAt: new Date(),
      },
    });
    await audit.logAction({
      companyId,
      actorUserId,
      action: "edible.packaging.transfer",
      entityType: "EdibleBatch",
      entityId: batch.id,
      after: { packagingLotId: lot.id },
    });
    return { packagingLotId: lot.id, sku: lot.sku };
  }

  async analyticsSnapshot(companyId: string) {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const [rows, laborAgg, ingredientAgg, taskWeek] = await Promise.all([
      prisma.edibleBatch.findMany({ where: { companyId } }),
      prisma.laborEntry.aggregate({
        where: { companyId, stage: "EDIBLES" },
        _sum: { totalCost: true, hours: true },
      }),
      prisma.edibleIngredient.aggregate({
        where: { edibleBatch: { companyId } },
        _sum: { weight: true },
      }),
      prisma.edibleTaskLog.count({
        where: { companyId, createdAt: { gte: weekAgo } },
      }),
    ]);
    const n = rows.length || 1;
    const completed = rows.filter((r) => r.status === "COMPLETED");
    const failed = rows.filter((r) => r.status === "QA_FAILED");
    const totalOil = g(rows.reduce((s, r) => s + g(r.oilInputGrams), 0));
    const totalWaste = g(rows.reduce((s, r) => s + g(r.wasteGrams), 0));
    const totalMg = g(rows.reduce((s, r) => s + g(r.totalMgInput), 0));
    const yields = completed
      .map((r) =>
        r.expectedYield && r.expectedYield > 0 && r.actualYield != null
          ? g((100 * r.actualYield) / r.expectedYield)
          : null,
      )
      .filter((x): x is number => x != null);
    const avgYield = yields.length ? g(yields.reduce((a, b) => a + b, 0) / yields.length) : null;
    const laborUsd = g(Number(laborAgg._sum.totalCost ?? 0));
    const laborHrs = g(Number(laborAgg._sum.hours ?? 0));
    const piecesForCost = completed.reduce(
      (s, r) => s + Math.max(0, Math.floor(Number(r.actualYield ?? r.targetPieces ?? 0))),
      0,
    );
    const ingredientG = g(Number(ingredientAgg._sum.weight ?? 0));
    return {
      batchCount: rows.length,
      completedCount: completed.length,
      failedBatchPct: g((100 * failed.length) / n),
      oilUtilizationGrams: totalOil,
      wastePct: totalOil > 0 ? g((100 * totalWaste) / totalOil) : 0,
      totalMgScheduled: totalMg,
      avgYieldPct: avgYield,
      mgEfficiencyHint: totalOil > 0 && totalMg > 0 ? g(totalMg / totalOil) : null,
      laborCostUsd: laborUsd,
      laborHours: laborHrs,
      costPerUnitUsd: piecesForCost > 0 && laborUsd > 0 ? g(laborUsd / piecesForCost) : null,
      ingredientWeightGrams: ingredientG,
      taskCompletionsLast7Days: taskWeek,
    };
  }
}
