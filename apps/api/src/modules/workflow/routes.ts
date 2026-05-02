import { Router } from "express";
import { z } from "zod";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { batchIdParam, cultPackStartSchema, cultWeighSchema, cultivationCreateSchema, exBiomassSchema, exCompleteSchema, exRunIdParam, extractionCreateShellSchema, extractionPackagingStartSchema, extPackWeighSchema, freshSetSchema, cultivationUpdateSchema, lotIdParam, packagingLotUpdateSchema, runIdParam, sealExtractionSchema, trimSetSchema, sourcePackageConsumeSchema, sourcePackageCreateSchema, sourcePackageIdParam, sourcePackageUpdateSchema, extractionRunUpdateSchema } from "../../validation/schemas.js";
import { WorkflowService } from "../../services/workflowService.js";
import { requireRole } from "../../middleware/rbac.js";
export const workflowRouter = Router();
const workflowService = new WorkflowService();
workflowRouter.post("/cultivation-batches", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "CULTIVATION_SPECIALIST"]), validate({ body: cultivationCreateSchema }), asyncHandler(async (req, res) => {
    const batch = await workflowService.createCultivation({
        companyId: getScopedCompanyId(req),
        actorUserId: req.auth.userId,
        ...req.body
    });
    res.status(201).json(batch);
}));
workflowRouter.get("/cultivation-batches/:batchId/operational-state", validate({ params: batchIdParam }), asyncHandler(async (req, res) => {
    const { batchId } = req.params;
    const state = await workflowService.getOperationalState(getScopedCompanyId(req), batchId);
    res.json(state);
}));
workflowRouter.patch("/cultivation-batches/:batchId", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "CULTIVATION_SPECIALIST"]), validate({ params: batchIdParam, body: cultivationUpdateSchema }), asyncHandler(async (req, res) => {
    const { batchId } = req.params;
    const updated = await workflowService.updateCultivation(getScopedCompanyId(req), req.auth.userId, {
        batchId,
        room: req.body.room,
        bay: req.body.bay,
        table: req.body.table,
        plantedAt: req.body.plantedAt,
        complete: req.body.complete,
        cultivationUiState: req.body.cultivationUiState
    });
    res.json(updated);
}));
workflowRouter.delete("/cultivation-batches/:batchId", requireRole(["OWNER", "ADMIN"]), validate({ params: batchIdParam }), asyncHandler(async (req, res) => {
    const { batchId } = req.params;
    const out = await workflowService.deleteCultivation(getScopedCompanyId(req), req.auth.userId, batchId);
    res.json(out);
}));
workflowRouter.post("/cultivation-batches/:batchId/trim", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "CULTIVATION_SPECIALIST"]), validate({ params: batchIdParam, body: trimSetSchema }), asyncHandler(async (req, res) => {
    const { batchId } = req.params;
    const out = await workflowService.setTrimState(getScopedCompanyId(req), req.auth.userId, {
        batchId,
        toExtractionGrams: req.body.toExtractionGrams,
        consumedGrams: req.body.consumedGrams
    });
    res.json(out);
}));
workflowRouter.get("/source-packages", asyncHandler(async (req, res) => {
    const cultivationBatchId = typeof req.query?.cultivationBatchId === "string" ? String(req.query.cultivationBatchId) : undefined;
    const rows = await workflowService.listSourcePackages(getScopedCompanyId(req), cultivationBatchId);
    res.json({ rows });
}));
workflowRouter.post("/source-packages", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "CULTIVATION_SPECIALIST", "EXTRACTION_SPECIALIST"]), validate({ body: sourcePackageCreateSchema }), asyncHandler(async (req, res) => {
    const row = await workflowService.createSourcePackage(getScopedCompanyId(req), req.auth.userId, req.body);
    res.status(201).json(row);
}));
workflowRouter.patch("/source-packages/:sourcePackageId", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "CULTIVATION_SPECIALIST", "EXTRACTION_SPECIALIST"]), validate({ params: sourcePackageIdParam, body: sourcePackageUpdateSchema }), asyncHandler(async (req, res) => {
    const { sourcePackageId } = req.params;
    const row = await workflowService.updateSourcePackage(getScopedCompanyId(req), req.auth.userId, {
        sourcePackageId,
        canonicalName: req.body.canonicalName
    });
    res.json(row);
}));
workflowRouter.post("/source-packages/:sourcePackageId/consume", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "EXTRACTION_SPECIALIST"]), validate({ params: sourcePackageIdParam, body: sourcePackageConsumeSchema }), asyncHandler(async (req, res) => {
    const { sourcePackageId } = req.params;
    const row = await workflowService.consumeSourcePackage(getScopedCompanyId(req), req.auth.userId, {
        sourcePackageId,
        grams: req.body.grams
    });
    res.json(row);
}));
workflowRouter.delete("/source-packages/:sourcePackageId", requireRole(["OWNER", "ADMIN"]), validate({ params: sourcePackageIdParam }), asyncHandler(async (req, res) => {
    const { sourcePackageId } = req.params;
    const out = await workflowService.deleteSourcePackage(getScopedCompanyId(req), req.auth.userId, sourcePackageId);
    res.json(out);
}));
workflowRouter.post("/cultivation-batches/:batchId/fresh-frozen", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "CULTIVATION_SPECIALIST", "EXTRACTION_SPECIALIST"]), validate({ params: batchIdParam, body: freshSetSchema }), asyncHandler(async (req, res) => {
    const { batchId } = req.params;
    const out = await workflowService.setFreshFrozen(getScopedCompanyId(req), req.auth.userId, {
        batchId,
        toExtractionGrams: req.body.toExtractionGrams,
        extractionRunId: req.body.extractionRunId
    });
    res.json(out);
}));
workflowRouter.patch("/extraction-runs/:runId", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "EXTRACTION_SPECIALIST"]), validate({ params: runIdParam, body: extractionRunUpdateSchema }), asyncHandler(async (req, res) => {
    const { runId } = req.params;
    const run = await workflowService.updateExtractionRun(getScopedCompanyId(req), req.auth.userId, {
        runId,
        method: req.body.method,
        supplyUsed: req.body.supplyUsed,
        extractionUiState: req.body.extractionUiState
    });
    res.json(run);
}));
workflowRouter.delete("/extraction-runs/:runId", requireRole(["OWNER", "ADMIN"]), validate({ params: runIdParam }), asyncHandler(async (req, res) => {
    const { runId } = req.params;
    const out = await workflowService.deleteExtractionRun(getScopedCompanyId(req), req.auth.userId, runId);
    res.json(out);
}));
workflowRouter.post("/cultivation-batches/:batchId/cultivation-packaging", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "CULTIVATION_SPECIALIST", "PACKAGING_SPECIALIST"]), validate({ params: batchIdParam, body: cultPackStartSchema }), asyncHandler(async (req, res) => {
    const { batchId } = req.params;
    const run = await workflowService.startCultPackaging(getScopedCompanyId(req), req.auth.userId, {
        batchId,
        line: req.body.line,
        mode: req.body.mode,
        openRunId: req.body.openRunId
    });
    res.status(201).json(run);
}));
workflowRouter.patch("/packaging-lots/:lotId", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "PACKAGING_SPECIALIST"]), validate({ params: lotIdParam, body: packagingLotUpdateSchema }), asyncHandler(async (req, res) => {
    const { lotId } = req.params;
    const lot = await workflowService.updatePackagingLot(getScopedCompanyId(req), req.auth.userId, {
        lotId,
        sku: req.body.sku,
        gramsPerUnit: req.body.gramsPerUnit,
        defaultTemplate: req.body.defaultTemplate,
        packagingUiState: req.body.packagingUiState
    });
    res.json(lot);
}));
workflowRouter.delete("/packaging-lots/:lotId", requireRole(["OWNER", "ADMIN"]), validate({ params: lotIdParam }), asyncHandler(async (req, res) => {
    const { lotId } = req.params;
    const out = await workflowService.deletePackagingLot(getScopedCompanyId(req), req.auth.userId, lotId);
    res.json(out);
}));
workflowRouter.post("/cultivation-packaging-runs/:runId/weigh", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "CULTIVATION_SPECIALIST", "PACKAGING_SPECIALIST"]), validate({ params: runIdParam, body: cultWeighSchema }), asyncHandler(async (req, res) => {
    const { runId } = req.params;
    const run = await workflowService.weighCultPackaging(getScopedCompanyId(req), req.auth.userId, {
        runId,
        netProductGrams: req.body.netProductGrams,
        terpeneGrams: req.body.terpeneGrams,
        note: req.body.note
    });
    res.json(run);
}));
workflowRouter.post("/cultivation-packaging-runs/:runId/finish", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "CULTIVATION_SPECIALIST", "PACKAGING_SPECIALIST"]), validate({ params: runIdParam }), asyncHandler(async (req, res) => {
    const { runId } = req.params;
    const run = await workflowService.finishCultPackaging(getScopedCompanyId(req), req.auth.userId, runId);
    res.json(run);
}));
workflowRouter.post("/extraction-runs", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "EXTRACTION_SPECIALIST"]), validate({ body: extractionCreateShellSchema }), asyncHandler(async (req, res) => {
    const run = await workflowService.createExtractionShell(getScopedCompanyId(req), req.auth.userId, req.body.cultivationBatchId);
    res.status(201).json(run);
}));
workflowRouter.post("/extraction-runs/:runId/biomass-prep/start", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "EXTRACTION_SPECIALIST"]), validate({ params: runIdParam }), asyncHandler(async (req, res) => {
    const { runId } = req.params;
    const run = await workflowService.startBiomassPrep(getScopedCompanyId(req), req.auth.userId, runId);
    res.json(run);
}));
workflowRouter.post("/extraction-runs/:runId/socks/start", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "EXTRACTION_SPECIALIST"]), validate({ params: runIdParam }), asyncHandler(async (req, res) => {
    const { runId } = req.params;
    const run = await workflowService.socksStart(getScopedCompanyId(req), req.auth.userId, runId);
    res.json(run);
}));
workflowRouter.post("/extraction-runs/:runId/socks/stop", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "EXTRACTION_SPECIALIST"]), validate({ params: runIdParam }), asyncHandler(async (req, res) => {
    const { runId } = req.params;
    const run = await workflowService.socksStop(getScopedCompanyId(req), req.auth.userId, runId);
    res.json(run);
}));
workflowRouter.post("/extraction-runs/:runId/biomass", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "EXTRACTION_SPECIALIST"]), validate({ params: runIdParam, body: exBiomassSchema.extend({ cultivationBatchId: z.string().cuid() }) }), asyncHandler(async (req, res) => {
    const { runId } = req.params;
    const line = await workflowService.addExtractionBiomass(getScopedCompanyId(req), req.auth.userId, {
        runId,
        cultivationBatchId: req.body.cultivationBatchId,
        sourceType: req.body.sourceType,
        grams: req.body.grams,
        sockWeightGrams: req.body.sockWeightGrams
    });
    res.status(201).json(line);
}));
workflowRouter.post("/extraction-runs/:runId/seal-input", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "EXTRACTION_SPECIALIST"]), validate({ params: runIdParam, body: sealExtractionSchema }), asyncHandler(async (req, res) => {
    const { runId } = req.params;
    const run = await workflowService.sealExtractionInput(getScopedCompanyId(req), req.auth.userId, {
        runId,
        method: req.body.method,
        supplyUsed: req.body.supplyUsed
    });
    res.json(run);
}));
workflowRouter.post("/extraction-runs/:runId/complete", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "EXTRACTION_SPECIALIST"]), validate({ params: runIdParam, body: exCompleteSchema }), asyncHandler(async (req, res) => {
    const { runId } = req.params;
    const run = await workflowService.completeExtraction(getScopedCompanyId(req), req.auth.userId, {
        runId,
        outputGrams: req.body.outputGrams
    });
    res.json(run);
}));
workflowRouter.post("/extraction-runs/:extractionRunId/packaging", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "PACKAGING_SPECIALIST"]), validate({ params: exRunIdParam, body: extractionPackagingStartSchema }), asyncHandler(async (req, res) => {
    const { extractionRunId } = req.params;
    const lot = await workflowService.startExtractionPackaging(getScopedCompanyId(req), req.auth.userId, {
        extractionRunId,
        sku: req.body.sku,
        gramsPerUnit: req.body.gramsPerUnit,
        defaultTemplate: req.body.defaultTemplate
    });
    res.status(201).json(lot);
}));
workflowRouter.post("/packaging-lots/:lotId/weigh", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "PACKAGING_SPECIALIST"]), validate({ params: lotIdParam, body: extPackWeighSchema }), asyncHandler(async (req, res) => {
    const { lotId } = req.params;
    const pack = await workflowService.weighExtractionPackaging(getScopedCompanyId(req), req.auth.userId, {
        lotId,
        netOutputGrams: req.body.netOutputGrams,
        terpeneGrams: req.body.terpeneGrams
    });
    res.json(pack);
}));
workflowRouter.post("/packaging-lots/:lotId/finish", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "PACKAGING_SPECIALIST"]), validate({ params: lotIdParam }), asyncHandler(async (req, res) => {
    const { lotId } = req.params;
    const lot = await workflowService.finishExtractionPackaging(getScopedCompanyId(req), req.auth.userId, lotId);
    res.json(lot);
}));
workflowRouter.get("/revision", asyncHandler(async (req, res) => {
    const out = await workflowService.getWorkflowRevision(getScopedCompanyId(req));
    res.json(out);
}));
workflowRouter.get("/active", asyncHandler(async (req, res) => {
    const rows = await workflowService.listActive(getScopedCompanyId(req));
    res.json(rows);
}));
