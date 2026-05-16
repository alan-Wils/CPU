import { Router } from "express";
import { z } from "zod";
import {
  estimatedGummyWeightGramsFromMoldMl,
  planPectinMultiAdditiveBatch,
  planPectinSingleAdditiveBatch,
} from "../../lib/pectinMeltToMakeFormula.js";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { AppError } from "../../errors/AppError.js";
import { EdiblesService } from "./ediblesService.js";
import { isEdiblesManagerRole, userMayAccessEdibles } from "./ediblesAccess.js";

const service = new EdiblesService();

export function requireEdiblesAccess(req: any, res: any, next: any) {
  const role = String(req.auth?.role || "").trim().toUpperCase();
  const perms = (req.auth as { permissions?: string[] } | undefined)?.permissions;
  if (userMayAccessEdibles(role, perms)) {
    next();
    return;
  }
  res.status(403).json({ message: "Forbidden" });
}

function requireEdiblesManager(req: any, res: any, next: any) {
  const role = String(req.auth?.role || "").trim().toUpperCase();
  if (isEdiblesManagerRole(role)) {
    next();
    return;
  }
  res.status(403).json({ message: "Forbidden — edibles manager or admin required" });
}

const edibleBatchIdParam = z.object({ batchId: z.string().cuid() });
const extractionRunLookupParam = z.object({ extractionRunId: z.string().cuid() });

const createBatchSchema = z.object({
  sku: z.string().min(1).max(120),
  flavor: z.string().min(1).max(120),
  productType: z.string().min(1).max(80),
  targetMgPerPiece: z.number().positive().max(5000),
  targetPieces: z.number().int().positive().max(10_000_000),
  extractionRunId: z.string().cuid(),
  oilInputGrams: z.number().positive().max(1_000_000),
  potencyMgPerGram: z.number().nonnegative().max(2000).optional().nullable(),
  notes: z.string().max(8000).optional().nullable(),
  expectedYield: z.number().int().positive().max(10_000_000).optional().nullable(),
});

const patchBatchSchema = z
  .object({
    stage: z.string().min(2).max(64).optional(),
    status: z.string().min(2).max(64).optional(),
    notes: z.union([z.string().max(8000), z.null()]).optional(),
    actualYield: z.number().int().nonnegative().max(10_000_000).optional().nullable(),
    wasteGrams: z.number().nonnegative().max(1_000_000).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: "Provide at least one field" });

const taskLogSchema = z.object({
  taskType: z.string().min(1).max(200),
  startedAt: z.string().datetime().optional().nullable(),
  completedAt: z.string().datetime().optional().nullable(),
  durationMinutes: z.number().int().nonnegative().max(24 * 60).optional().nullable(),
  employees: z.string().max(2000).optional().nullable(),
  notes: z.string().max(8000).optional().nullable(),
  temperature: z.number().optional().nullable(),
  weight: z.number().nonnegative().optional().nullable(),
});

const ingredientSchema = z.object({
  ingredientName: z.string().min(1).max(200),
  lotNumber: z.string().max(120).optional().nullable(),
  weight: z.number().positive().max(1_000_000),
  unit: z.string().max(16).optional(),
});

const qaSubmitSchema = z.object({
  potencyStatus: z.enum(["PENDING", "PASSED", "FAILED"]),
  homogeneityStatus: z.enum(["PENDING", "PASSED", "FAILED"]),
  microbialStatus: z.enum(["PENDING", "PASSED", "FAILED"]),
  failedReason: z.string().max(2000).optional().nullable(),
  notes: z.string().max(8000).optional().nullable(),
});

const qaReviewSchema = z.object({
  qaTestId: z.string().cuid(),
  approve: z.boolean(),
  notes: z.string().max(8000).optional().nullable(),
  failedReason: z.string().max(2000).optional().nullable(),
});

const transferSchema = z.object({
  gramsPerUnit: z.number().positive().max(100),
  defaultTemplate: z.string().max(120).optional().nullable(),
});

/** Melt-to-Make pectin workbook parity — used by the edibles kitchen batch planner UI. */
const pectinPreviewSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("single"),
    batchSizeGrams: z.number().positive().max(10_000_000),
    potencyFraction: z.number().positive().max(1),
    targetMgPerPiece: z.number().positive().max(5000),
    gramsPerPiece: z.number().positive().max(100),
    citricMassFraction: z.number().positive().max(0.2).optional(),
    lineWasteFraction: z.number().min(0).max(0.5).optional(),
    mctCarrierPercent: z.number().min(0).max(1000).optional(),
    basePartAGrams: z.number().positive().max(10_000_000).optional(),
  }),
  z.object({
    kind: z.literal("multi"),
    batchSizeGrams: z.number().positive().max(10_000_000),
    gramsPerPiece: z.number().positive().max(100),
    additives: z
      .array(
        z.object({
          goalMgPerPiece: z.number().nonnegative().max(5000),
          potencyFraction: z.number().positive().max(1),
        }),
      )
      .min(1)
      .max(8),
    citricMassFraction: z.number().positive().max(0.2).optional(),
    extraMassFractions: z.array(z.number().nonnegative().max(0.5)).max(16).optional(),
    lineWasteFraction: z.number().min(0).max(0.5).optional(),
    mctCarrierPercent: z.number().min(0).max(1000).optional(),
    basePartAGrams: z.number().positive().max(10_000_000).optional(),
  }),
  z.object({
    kind: z.literal("mold_weight"),
    moldMl: z.number().positive().max(500),
    densityFactor: z.number().positive().max(5).optional(),
  }),
]);

export const ediblesRouter = Router();

ediblesRouter.use(requireEdiblesAccess);

ediblesRouter.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const data = await service.getDashboard(getScopedCompanyId(req));
    res.json(data);
  }),
);

ediblesRouter.get(
  "/extraction-oil-options",
  asyncHandler(async (req, res) => {
    const rows = await service.listExtractionOilOptions(getScopedCompanyId(req));
    res.json({ options: rows });
  }),
);

ediblesRouter.get(
  "/extraction-oil-options/by-run/:extractionRunId",
  validate({ params: extractionRunLookupParam }),
  asyncHandler(async (req, res) => {
    const row = await service.resolveExtractionOilOption(getScopedCompanyId(req), req.params.extractionRunId);
    res.json({ option: row });
  }),
);

ediblesRouter.post(
  "/pectin-formula-preview",
  validate({ body: pectinPreviewSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof pectinPreviewSchema>;
    try {
      if (body.kind === "single") {
        const plan = planPectinSingleAdditiveBatch({
          batchSizeGrams: body.batchSizeGrams,
          potencyFraction: body.potencyFraction,
          targetMgPerPiece: body.targetMgPerPiece,
          gramsPerPiece: body.gramsPerPiece,
          citricMassFraction: body.citricMassFraction,
          lineWasteFraction: body.lineWasteFraction,
          mctCarrierPercent: body.mctCarrierPercent,
          basePartAGrams: body.basePartAGrams,
        });
        res.json({ kind: "single", plan });
        return;
      }
      if (body.kind === "multi") {
        const plan = planPectinMultiAdditiveBatch({
          batchSizeGrams: body.batchSizeGrams,
          gramsPerPiece: body.gramsPerPiece,
          additives: body.additives,
          citricMassFraction: body.citricMassFraction,
          extraMassFractions: body.extraMassFractions,
          lineWasteFraction: body.lineWasteFraction,
          mctCarrierPercent: body.mctCarrierPercent,
          basePartAGrams: body.basePartAGrams,
        });
        res.json({ kind: "multi", plan });
        return;
      }
      const gramsPerPiece = estimatedGummyWeightGramsFromMoldMl(body.moldMl, body.densityFactor);
      res.json({
        kind: "mold_weight",
        moldMl: body.moldMl,
        densityFactor: body.densityFactor ?? 1.34,
        gramsPerPiece,
      });
    } catch (e) {
      if (e instanceof RangeError) {
        throw new AppError(e.message, 400);
      }
      throw e;
    }
  }),
);

ediblesRouter.get(
  "/analytics",
  asyncHandler(async (req, res) => {
    const data = await service.analyticsSnapshot(getScopedCompanyId(req));
    res.json(data);
  }),
);

ediblesRouter.post(
  "/batches",
  validate({ body: createBatchSchema }),
  asyncHandler(async (req, res) => {
    const row = await service.createBatch(getScopedCompanyId(req), req.auth.userId, req.body);
    res.status(201).json(row);
  }),
);

ediblesRouter.patch(
  "/batches/:batchId",
  validate({ params: edibleBatchIdParam, body: patchBatchSchema }),
  asyncHandler(async (req, res) => {
    const row = await service.updateBatch(
      getScopedCompanyId(req),
      req.auth.userId,
      req.params.batchId,
      req.body,
    );
    res.json(row);
  }),
);

ediblesRouter.delete(
  "/batches/:batchId",
  requireEdiblesManager,
  validate({ params: edibleBatchIdParam }),
  asyncHandler(async (req, res) => {
    const out = await service.deleteBatch(getScopedCompanyId(req), req.auth.userId, req.params.batchId);
    res.json(out);
  }),
);

ediblesRouter.post(
  "/batches/:batchId/task-logs",
  validate({ params: edibleBatchIdParam, body: taskLogSchema }),
  asyncHandler(async (req, res) => {
    const row = await service.addTaskLog(
      getScopedCompanyId(req),
      req.auth.userId,
      req.params.batchId,
      req.body,
    );
    res.status(201).json(row);
  }),
);

ediblesRouter.post(
  "/batches/:batchId/ingredients",
  validate({ params: edibleBatchIdParam, body: ingredientSchema }),
  asyncHandler(async (req, res) => {
    const row = await service.addIngredient(
      getScopedCompanyId(req),
      req.auth.userId,
      req.params.batchId,
      req.body,
    );
    res.status(201).json(row);
  }),
);

ediblesRouter.post(
  "/batches/:batchId/qa",
  validate({ params: edibleBatchIdParam, body: qaSubmitSchema }),
  asyncHandler(async (req, res) => {
    const row = await service.submitQa(getScopedCompanyId(req), req.auth.userId, req.params.batchId, req.body);
    res.status(201).json(row);
  }),
);

ediblesRouter.post(
  "/batches/:batchId/qa/manager-review",
  requireEdiblesManager,
  validate({ params: edibleBatchIdParam, body: qaReviewSchema }),
  asyncHandler(async (req, res) => {
    const out = await service.managerReviewQa(
      getScopedCompanyId(req),
      req.auth.userId,
      req.params.batchId,
      req.body,
    );
    res.json(out);
  }),
);

ediblesRouter.post(
  "/batches/:batchId/transfer-packaging",
  requireEdiblesManager,
  validate({ params: edibleBatchIdParam, body: transferSchema }),
  asyncHandler(async (req, res) => {
    const out = await service.transferToPackaging(
      getScopedCompanyId(req),
      req.auth.userId,
      req.params.batchId,
      req.body,
    );
    res.status(201).json(out);
  }),
);
