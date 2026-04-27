import { Router } from "express";
import { z } from "zod";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import {
  batchIdParam,
  cultPackStartSchema,
  cultWeighSchema,
  cultivationCreateSchema,
  exBiomassSchema,
  exCompleteSchema,
  exRunIdParam,
  extractionCreateShellSchema,
  extractionPackagingStartSchema,
  extPackWeighSchema,
  freshSetSchema,
  cultivationUpdateSchema,
  lotIdParam,
  packagingLotUpdateSchema,
  runIdParam,
  sealExtractionSchema,
  trimSetSchema,
  sourcePackageConsumeSchema,
  sourcePackageCreateSchema,
  sourcePackageIdParam,
  sourcePackageUpdateSchema,
  extractionRunUpdateSchema
} from "../../validation/schemas.js";
import { WorkflowService } from "../../services/workflowService.js";
import { requireRole } from "../../middleware/rbac.js";

export const workflowRouter = Router();
const workflowService = new WorkflowService();

workflowRouter.post(
  "/cultivation-batches",
  requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "CULTIVATION_SPECIALIST"]),
  validate({ body: cultivationCreateSchema }),
  asyncHandler(async (req, res) => {
    const batch = await workflowService.createCultivation({
      companyId: req.auth!.companyId,
      actorUserId: req.auth!.userId,
      ...req.body
    });
    res.status(201).json(batch);
  })
);

workflowRouter.get(
  "/cultivation-batches/:batchId/operational-state",
  validate({ params: batchIdParam }),
  asyncHandler(async (req, res) => {
    const { batchId } = req.params as { batchId: string };
    const state = await workflowService.getOperationalState(req.auth!.companyId, batchId);
    res.json(state);
  })
);

workflowRouter.patch(
  "/cultivation-batches/:batchId",
  requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "CULTIVATION_SPECIALIST"]),
  validate({ params: batchIdParam, body: cultivationUpdateSchema }),
  asyncHandler(async (req, res) => {
    const { batchId } = req.params as { batchId: string };
    const updated = await workflowService.updateCultivation(req.auth!.companyId, req.auth!.userId, {
      batchId,
      room: req.body.room,
      bay: req.body.bay,
      table: req.body.table,
      plantedAt: req.body.plantedAt,
      complete: req.body.complete
    });
    res.json(updated);
  })
);

workflowRouter.delete(
  "/cultivation-batches/:batchId",
  requireRole(["OWNER", "ADMIN"]),
  validate({ params: batchIdParam }),
  asyncHandler(async (req, res) => {
    const { batchId } = req.params as { batchId: string };
    const out = await workflowService.deleteCultivation(req.auth!.companyId, req.auth!.userId, batchId);
    res.json(out);
  })
);

workflowRouter.post(
  "/cultivation-batches/:batchId/trim",
  requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "CULTIVATION_SPECIALIST"]),
  validate({ params: batchIdParam, body: trimSetSchema }),
  asyncHandler(async (req, res) => {
    const { batchId } = req.params as { batchId: string };
    const out = await workflowService.setTrimState(req.auth!.companyId, req.auth!.userId, {
      batchId,
      toExtractionGrams: req.body.toExtractionGrams,
      consumedGrams: req.body.consumedGrams
    });
    res.json(out);
  })
);

workflowRouter.get(
  "/source-packages",
  asyncHandler(async (req, res) => {
    const cultivationBatchId =
      typeof (req.query as any)?.cultivationBatchId === "string" ? String((req.query as any).cultivationBatchId) : undefined;
    const rows = await workflowService.listSourcePackages(req.auth!.companyId, cultivationBatchId);
    res.json({ rows });
  })
);

workflowRouter.post(
  "/source-packages",
  requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "CULTIVATION_SPECIALIST", "EXTRACTION_SPECIALIST"]),
  validate({ body: sourcePackageCreateSchema }),
  asyncHandler(async (req, res) => {
    const row = await workflowService.createSourcePackage(req.auth!.companyId, req.auth!.userId, req.body);
    res.status(201).json(row);
  })
);

workflowRouter.patch(
  "/source-packages/:sourcePackageId",
  requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "CULTIVATION_SPECIALIST", "EXTRACTION_SPECIALIST"]),
  validate({ params: sourcePackageIdParam, body: sourcePackageUpdateSchema }),
  asyncHandler(async (req, res) => {
    const { sourcePackageId } = req.params as { sourcePackageId: string };
    const row = await workflowService.updateSourcePackage(req.auth!.companyId, req.auth!.userId, {
      sourcePackageId,
      canonicalName: req.body.canonicalName
    });
    res.json(row);
  })
);

workflowRouter.post(
  "/source-packages/:sourcePackageId/consume",
  requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "EXTRACTION_SPECIALIST"]),
  validate({ params: sourcePackageIdParam, body: sourcePackageConsumeSchema }),
  asyncHandler(async (req, res) => {
    const { sourcePackageId } = req.params as { sourcePackageId: string };
    const row = await workflowService.consumeSourcePackage(req.auth!.companyId, req.auth!.userId, {
      sourcePackageId,
      grams: req.body.grams
    });
    res.json(row);
  })
);

workflowRouter.delete(
  "/source-packages/:sourcePackageId",
  requireRole(["OWNER", "ADMIN"]),
  validate({ params: sourcePackageIdParam }),
  asyncHandler(async (req, res) => {
    const { sourcePackageId } = req.params as { sourcePackageId: string };
    const out = await workflowService.deleteSourcePackage(req.auth!.companyId, req.auth!.userId, sourcePackageId);
    res.json(out);
  })
);

workflowRouter.post(
  "/cultivation-batches/:batchId/fresh-frozen",
  requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "CULTIVATION_SPECIALIST", "EXTRACTION_SPECIALIST"]),
  validate({ params: batchIdParam, body: freshSetSchema }),
  asyncHandler(async (req, res) => {
    const { batchId } = req.params as { batchId: string };
    const out = await workflowService.setFreshFrozen(req.auth!.companyId, req.auth!.userId, {
      batchId,
      toExtractionGrams: req.body.toExtractionGrams,
      extractionRunId: req.body.extractionRunId
    });
    res.json(out);
  })
);

workflowRouter.patch(
  "/extraction-runs/:runId",
  requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "EXTRACTION_SPECIALIST"]),
  validate({ params: runIdParam, body: extractionRunUpdateSchema }),
  asyncHandler(async (req, res) => {
    const { runId } = req.params as { runId: string };
    const run = await workflowService.updateExtractionRun(req.auth!.companyId, req.auth!.userId, {
      runId,
      method: req.body.method,
      supplyUsed: req.body.supplyUsed
    });
    res.json(run);
  })
);

workflowRouter.delete(
  "/extraction-runs/:runId",
  requireRole(["OWNER", "ADMIN"]),
  validate({ params: runIdParam }),
  asyncHandler(async (req, res) => {
    const { runId } = req.params as { runId: string };
    const out = await workflowService.deleteExtractionRun(req.auth!.companyId, req.auth!.userId, runId);
    res.json(out);
  })
);

workflowRouter.post(
  "/cultivation-batches/:batchId/cultivation-packaging",
  requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "CULTIVATION_SPECIALIST", "PACKAGING_SPECIALIST"]),
  validate({ params: batchIdParam, body: cultPackStartSchema }),
  asyncHandler(async (req, res) => {
    const { batchId } = req.params as { batchId: string };
    const run = await workflowService.startCultPackaging(req.auth!.companyId, req.auth!.userId, {
      batchId,
      line: req.body.line,
      mode: req.body.mode,
      openRunId: req.body.openRunId
    });
    res.status(201).json(run);
  })
);

workflowRouter.patch(
  "/packaging-lots/:lotId",
  requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "PACKAGING_SPECIALIST"]),
  validate({ params: lotIdParam, body: packagingLotUpdateSchema }),
  asyncHandler(async (req, res) => {
    const { lotId } = req.params as { lotId: string };
    const lot = await workflowService.updatePackagingLot(req.auth!.companyId, req.auth!.userId, {
      lotId,
      sku: req.body.sku,
      gramsPerUnit: req.body.gramsPerUnit,
      defaultTemplate: req.body.defaultTemplate
    });
    res.json(lot);
  })
);

workflowRouter.delete(
  "/packaging-lots/:lotId",
  requireRole(["OWNER", "ADMIN"]),
  validate({ params: lotIdParam }),
  asyncHandler(async (req, res) => {
    const { lotId } = req.params as { lotId: string };
    const out = await workflowService.deletePackagingLot(req.auth!.companyId, req.auth!.userId, lotId);
    res.json(out);
  })
);

workflowRouter.post(
  "/cultivation-packaging-runs/:runId/weigh",
  requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "CULTIVATION_SPECIALIST", "PACKAGING_SPECIALIST"]),
  validate({ params: runIdParam, body: cultWeighSchema }),
  asyncHandler(async (req, res) => {
    const { runId } = req.params as { runId: string };
    const run = await workflowService.weighCultPackaging(req.auth!.companyId, req.auth!.userId, {
      runId,
      netProductGrams: req.body.netProductGrams,
      terpeneGrams: req.body.terpeneGrams,
      note: req.body.note
    });
    res.json(run);
  })
);

workflowRouter.post(
  "/cultivation-packaging-runs/:runId/finish",
  requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "CULTIVATION_SPECIALIST", "PACKAGING_SPECIALIST"]),
  validate({ params: runIdParam }),
  asyncHandler(async (req, res) => {
    const { runId } = req.params as { runId: string };
    const run = await workflowService.finishCultPackaging(req.auth!.companyId, req.auth!.userId, runId);
    res.json(run);
  })
);

workflowRouter.post(
  "/extraction-runs",
  requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "EXTRACTION_SPECIALIST"]),
  validate({ body: extractionCreateShellSchema }),
  asyncHandler(async (req, res) => {
    const run = await workflowService.createExtractionShell(
      req.auth!.companyId,
      req.auth!.userId,
      req.body.cultivationBatchId
    );
    res.status(201).json(run);
  })
);

workflowRouter.post(
  "/extraction-runs/:runId/biomass-prep/start",
  requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "EXTRACTION_SPECIALIST"]),
  validate({ params: runIdParam }),
  asyncHandler(async (req, res) => {
    const { runId } = req.params as { runId: string };
    const run = await workflowService.startBiomassPrep(req.auth!.companyId, req.auth!.userId, runId);
    res.json(run);
  })
);

workflowRouter.post(
  "/extraction-runs/:runId/socks/start",
  requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "EXTRACTION_SPECIALIST"]),
  validate({ params: runIdParam }),
  asyncHandler(async (req, res) => {
    const { runId } = req.params as { runId: string };
    const run = await workflowService.socksStart(req.auth!.companyId, req.auth!.userId, runId);
    res.json(run);
  })
);

workflowRouter.post(
  "/extraction-runs/:runId/socks/stop",
  requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "EXTRACTION_SPECIALIST"]),
  validate({ params: runIdParam }),
  asyncHandler(async (req, res) => {
    const { runId } = req.params as { runId: string };
    const run = await workflowService.socksStop(req.auth!.companyId, req.auth!.userId, runId);
    res.json(run);
  })
);

workflowRouter.post(
  "/extraction-runs/:runId/biomass",
  requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "EXTRACTION_SPECIALIST"]),
  validate({ params: runIdParam, body: exBiomassSchema.extend({ cultivationBatchId: z.string().cuid() }) }),
  asyncHandler(async (req, res) => {
    const { runId } = req.params as { runId: string };
    const line = await workflowService.addExtractionBiomass(req.auth!.companyId, req.auth!.userId, {
      runId,
      cultivationBatchId: req.body.cultivationBatchId,
      sourceType: req.body.sourceType,
      grams: req.body.grams,
      sockWeightGrams: req.body.sockWeightGrams
    });
    res.status(201).json(line);
  })
);

workflowRouter.post(
  "/extraction-runs/:runId/seal-input",
  requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "EXTRACTION_SPECIALIST"]),
  validate({ params: runIdParam, body: sealExtractionSchema }),
  asyncHandler(async (req, res) => {
    const { runId } = req.params as { runId: string };
    const run = await workflowService.sealExtractionInput(req.auth!.companyId, req.auth!.userId, {
      runId,
      method: req.body.method,
      supplyUsed: req.body.supplyUsed
    });
    res.json(run);
  })
);

workflowRouter.post(
  "/extraction-runs/:runId/complete",
  requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "EXTRACTION_SPECIALIST"]),
  validate({ params: runIdParam, body: exCompleteSchema }),
  asyncHandler(async (req, res) => {
    const { runId } = req.params as { runId: string };
    const run = await workflowService.completeExtraction(req.auth!.companyId, req.auth!.userId, {
      runId,
      outputGrams: req.body.outputGrams
    });
    res.json(run);
  })
);

workflowRouter.post(
  "/extraction-runs/:extractionRunId/packaging",
  requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "PACKAGING_SPECIALIST"]),
  validate({ params: exRunIdParam, body: extractionPackagingStartSchema }),
  asyncHandler(async (req, res) => {
    const { extractionRunId } = req.params as { extractionRunId: string };
    const lot = await workflowService.startExtractionPackaging(req.auth!.companyId, req.auth!.userId, {
      extractionRunId,
      sku: req.body.sku,
      gramsPerUnit: req.body.gramsPerUnit,
      defaultTemplate: req.body.defaultTemplate
    });
    res.status(201).json(lot);
  })
);

workflowRouter.post(
  "/packaging-lots/:lotId/weigh",
  requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "PACKAGING_SPECIALIST"]),
  validate({ params: lotIdParam, body: extPackWeighSchema }),
  asyncHandler(async (req, res) => {
    const { lotId } = req.params as { lotId: string };
    const pack = await workflowService.weighExtractionPackaging(req.auth!.companyId, req.auth!.userId, {
      lotId,
      netOutputGrams: req.body.netOutputGrams,
      terpeneGrams: req.body.terpeneGrams
    });
    res.json(pack);
  })
);

workflowRouter.post(
  "/packaging-lots/:lotId/finish",
  requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "PACKAGING_SPECIALIST"]),
  validate({ params: lotIdParam }),
  asyncHandler(async (req, res) => {
    const { lotId } = req.params as { lotId: string };
    const lot = await workflowService.finishExtractionPackaging(req.auth!.companyId, req.auth!.userId, lotId);
    res.json(lot);
  })
);

workflowRouter.get(
  "/active",
  asyncHandler(async (req, res) => {
    const rows = await workflowService.listActive(req.auth!.companyId);
    // #region agent log
    fetch("http://127.0.0.1:7632/ingest/2f728e3e-c43e-4540-9407-a3bbee548e0f", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6beeea" },
      body: JSON.stringify({
        sessionId: "6beeea",
        runId: "pre-fix",
        hypothesisId: "H2",
        location: "api/workflow/routes.ts:GET/active",
        message: "Workflow active endpoint returning cultivation payload",
        data: {
          cultivationCount: Array.isArray((rows as any)?.cultivation) ? (rows as any).cultivation.length : 0,
          cultivationSample: (Array.isArray((rows as any)?.cultivation) ? (rows as any).cultivation : [])
            .slice(0, 5)
            .map((r: any) => ({
              id: String(r?.id || ""),
              strainAcronym: String(r?.strainAcronym || ""),
              batchChainCode: String(r?.batchChainCode || ""),
              autoStatus: String(r?.autoStatus || "")
            }))
        },
        timestamp: Date.now()
      })
    }).catch(() => {});
    // #endregion
    res.json(rows);
  })
);
