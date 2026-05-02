/**
 * Legacy HTTP paths expected by the Next.js SPA (`lib/*Api.ts`).
 * Railway runs `@cpu/api` (Prisma + workflow); these routes bridge to WorkflowService
 * so task completion persists `*UiState` JSON on parent rows.
 */
import { Router } from "express";
import { prisma } from "../../config/prisma.js";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { requireRole } from "../../middleware/rbac.js";
import { WorkflowService } from "../../services/workflowService.js";
import { logInfo } from "../../lib/logger.js";
import { AppError } from "../../errors/AppError.js";
export const legacyCpuRouter = Router();
const workflowService = new WorkflowService();
function mapAreaToWorkflowStage(area) {
    const a = String(area || "").toLowerCase();
    if (a.includes("extract"))
        return "EXTRACTION";
    if (a.includes("packag"))
        return "PACKAGING";
    return "CULTIVATION";
}
function safeMinutes(value) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 1)
        return 1;
    return Math.min(n, 24 * 60);
}
function legacyLogNotePayload(body) {
    return JSON.stringify({
        area: body.area ?? "System",
        batch: body.batch ?? null,
        task: body.task ?? "Log",
        output: body.output ?? "",
        data: body.data && typeof body.data === "object" ? body.data : {},
        source: body.source ?? null,
        linkedBatch: body.linkedBatch ?? null
    });
}
function taskRowToLegacyLog(row) {
    const raw = String(row.note || "");
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && "task" in parsed) {
            const data = typeof parsed.data === "object" && parsed.data ? parsed.data : {};
            const loggedAtIso = row.createdAt.toISOString();
            return {
                id: row.id,
                area: parsed.area ?? "System",
                batch: parsed.batch ?? row.referenceId ?? "",
                task: parsed.task ?? "Log",
                output: parsed.output ?? "",
                people: data.people ?? "",
                minutes: String(data.minutes ?? row.minutes ?? ""),
                data: { ...data, loggedAt: data.loggedAt ?? row.createdAt.toLocaleString(), loggedAtIso },
                source: parsed.source ?? undefined,
                linkedBatch: parsed.linkedBatch ?? undefined,
                time: row.createdAt.toLocaleString(),
                loggedAt: row.createdAt.toLocaleString(),
                loggedAtIso
            };
        }
    }
    catch {
        /* fall through */
    }
    const stage = String(row.stage || "");
    const area = stage === "EXTRACTION" ? "Extraction" : stage === "PACKAGING" ? "Packaging" : "Cultivation";
    return {
        id: row.id,
        area,
        batch: row.referenceId ?? "",
        task: "Task",
        output: raw,
        people: "",
        minutes: String(row.minutes ?? ""),
        data: {},
        time: row.createdAt.toLocaleString(),
        loggedAt: row.createdAt.toLocaleString(),
        loggedAtIso: row.createdAt.toISOString()
    };
}
function mergeRecord(base, patch) {
    const a = base && typeof base === "object" && !Array.isArray(base) ? base : {};
    const b = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
    return { ...a, ...b };
}
function mapCultivationRowToLegacy(batch) {
    const ui = batch.cultivationUiState && typeof batch.cultivationUiState === "object"
        ? batch.cultivationUiState
        : {};
    const autoDone = batch.autoStatus === "AUTO_COMPLETED";
    return {
        ...ui,
        id: batch.id,
        strain: batch.strain,
        acronym: batch.strainAcronym,
        plantedAt: batch.plantedAt,
        room: batch.room ?? ui.room,
        bay: batch.bay ?? ui.bay,
        table: batch.table ?? ui.table,
        status: ui.status ?? (autoDone ? "Complete" : "Active"),
        stage: ui.stage ?? (autoDone ? "Complete" : "Clone"),
        plants: ui.plants ?? 0
    };
}
function mapExtractionRunToLegacy(run) {
    const ui = run.extractionUiState && typeof run.extractionUiState === "object" ? run.extractionUiState : {};
    return {
        ...ui,
        id: run.id,
        cultivationBatchId: run.cultivationBatchId,
        phase: run.phase,
        method: run.method,
        supplyUsed: run.supplyUsed,
        inputGrams: run.inputGrams,
        outputGrams: run.outputGrams
    };
}
function mapPackagingLotToLegacy(lot) {
    const ui = lot.packagingUiState && typeof lot.packagingUiState === "object" ? lot.packagingUiState : {};
    const statusLabel = lot.status === "COMPLETED" ? "Complete" : lot.status === "IN_PROGRESS" ? "In Progress" : String(lot.status || "");
    return {
        ...ui,
        id: lot.id,
        extractionRunId: lot.extractionRunId,
        status: ui.status ?? statusLabel,
        sku: lot.sku,
        gramsPerUnit: lot.gramsPerUnit,
        netOutputGrams: lot.netOutputGrams,
        terpeneGrams: lot.terpeneGrams,
        units: lot.units
    };
}
legacyCpuRouter.get("/logs", asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const rows = await prisma.taskLog.findMany({
        where: { companyId },
        orderBy: { createdAt: "desc" },
        take: 500
    });
    res.json(rows.map(taskRowToLegacyLog));
}));
legacyCpuRouter.post("/logs", asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const body = req.body || {};
    const stage = mapAreaToWorkflowStage(body.area);
    const minutes = safeMinutes(body?.data?.minutes ?? body.minutes);
    const note = legacyLogNotePayload(body);
    const referenceId = body.batch ? String(body.batch) : body.source ? String(body.source) : null;
    const row = await prisma.taskLog.create({
        data: {
            companyId,
            actorUserId: req.auth.userId,
            stage,
            note,
            minutes,
            referenceId: referenceId && referenceId.length ? referenceId.slice(0, 200) : null
        }
    });
    logInfo("[WORKFLOW_FIX] legacy_task_log_persisted", {
        entityType: "TaskLog",
        entityId: row.id,
        task: body.task,
        stage,
        referenceId: row.referenceId,
        minutes: row.minutes
    });
    res.status(201).json(taskRowToLegacyLog(row));
}));
legacyCpuRouter.get("/cultivation", asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const rows = await prisma.cultivationBatch.findMany({
        where: { companyId },
        orderBy: { updatedAt: "desc" },
        take: 200
    });
    res.json(rows.map(mapCultivationRowToLegacy));
}));
legacyCpuRouter.put("/cultivation/:batchId", requireRole([
    "OWNER",
    "ADMIN",
    "OPERATIONS_MANAGER",
    "CULTIVATION_SPECIALIST"
]), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const batchId = String(req.params.batchId || "");
    const body = req.body || {};
    const existing = await prisma.cultivationBatch.findFirst({ where: { id: batchId, companyId } });
    if (!existing) {
        throw new AppError("Cultivation batch not found", 404);
    }
    const prevUi = existing.cultivationUiState && typeof existing.cultivationUiState === "object"
        ? existing.cultivationUiState
        : {};
    const prevStage = String(prevUi.stage ?? "");
    const prevStatus = String(prevUi.status ?? existing.autoStatus ?? "");
    const mergedUi = mergeRecord(prevUi, body);
    if (mergedUi.id)
        delete mergedUi.id;
    const room = body.room ?? body.flowerRoom ?? existing.room ?? undefined;
    const bay = body.bay ?? body.flowerBay ?? existing.bay ?? undefined;
    const tableRaw = body.table ?? body.flowerTable
        ?? (Array.isArray(body.flowerTables) ? body.flowerTables.join(",") : undefined)
        ?? existing.table
        ?? undefined;
    const complete = body.complete === true
        || body.status === "Complete"
        || body.stage === "Complete"
        || mergedUi.status === "Complete"
        || mergedUi.stage === "Complete";
    const updated = await workflowService.updateCultivation(companyId, req.auth.userId, {
        batchId,
        room,
        bay,
        table: tableRaw !== undefined ? String(tableRaw) : undefined,
        plantedAt: body.plantedAt !== undefined ? new Date(body.plantedAt) : undefined,
        complete,
        cultivationUiState: mergedUi
    });
    const mapped = mapCultivationRowToLegacy(updated);
    logInfo("[WORKFLOW_FIX] cultivation_batch_parent_updated", {
        entityType: "CultivationBatch",
        entityId: batchId,
        task: body.lastTask ?? body.task,
        previousStage: prevStage,
        previousStatus: prevStatus,
        newStage: String(mapped.stage ?? ""),
        newStatus: String(mapped.status ?? ""),
        parentUpdateSucceeded: true,
        responseSummary: { id: mapped.id, stage: mapped.stage, status: mapped.status }
    });
    res.json(mapped);
}));
legacyCpuRouter.get("/extraction", asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const rows = await prisma.extractionRun.findMany({
        where: { companyId },
        orderBy: { updatedAt: "desc" },
        take: 200
    });
    res.json(rows.map(mapExtractionRunToLegacy));
}));
legacyCpuRouter.put("/extraction/:runId", requireRole([
    "OWNER",
    "ADMIN",
    "OPERATIONS_MANAGER",
    "EXTRACTION_SPECIALIST"
]), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const runId = String(req.params.runId || "");
    const body = req.body || {};
    const existing = await prisma.extractionRun.findFirst({ where: { id: runId, companyId } });
    if (!existing) {
        throw new AppError("Extraction run not found", 404);
    }
    const prevUi = existing.extractionUiState && typeof existing.extractionUiState === "object"
        ? existing.extractionUiState
        : {};
    const prevPhase = String(existing.phase ?? "");
    const mergedUi = mergeRecord(prevUi, body);
    if (mergedUi.id)
        delete mergedUi.id;
    const updated = await workflowService.updateExtractionRun(companyId, req.auth.userId, {
        runId,
        method: body.method ?? existing.method,
        supplyUsed: body.supplyUsed ?? existing.supplyUsed,
        extractionUiState: mergedUi
    });
    const mapped = mapExtractionRunToLegacy(updated);
    logInfo("[WORKFLOW_FIX] extraction_run_parent_updated", {
        entityType: "ExtractionRun",
        entityId: runId,
        task: body.lastTask ?? body.task,
        previousStage: prevPhase,
        newStage: String(updated.phase ?? ""),
        parentUpdateSucceeded: true,
        responseSummary: { id: mapped.id, phase: updated.phase }
    });
    res.json(mapped);
}));
legacyCpuRouter.get("/packaging", asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const rows = await prisma.packagingLot.findMany({
        where: { companyId },
        orderBy: { updatedAt: "desc" },
        take: 200
    });
    res.json(rows.map(mapPackagingLotToLegacy));
}));
legacyCpuRouter.put("/packaging/:lotId", requireRole([
    "OWNER",
    "ADMIN",
    "OPERATIONS_MANAGER",
    "PACKAGING_SPECIALIST"
]), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const lotId = String(req.params.lotId || "");
    const body = req.body || {};
    const existing = await prisma.packagingLot.findFirst({ where: { id: lotId, companyId } });
    if (!existing) {
        throw new AppError("Packaging lot not found", 404);
    }
    const prevUi = existing.packagingUiState && typeof existing.packagingUiState === "object"
        ? existing.packagingUiState
        : {};
    const prevStatus = String(existing.status ?? "");
    const mergedUi = mergeRecord(prevUi, body);
    if (mergedUi.id)
        delete mergedUi.id;
    const updated = await workflowService.updatePackagingLot(companyId, req.auth.userId, {
        lotId,
        sku: body.sku ?? existing.sku,
        gramsPerUnit: body.gramsPerUnit ?? existing.gramsPerUnit,
        defaultTemplate: body.defaultTemplate ?? existing.defaultTemplate ?? undefined,
        packagingUiState: mergedUi
    });
    const mapped = mapPackagingLotToLegacy(updated);
    logInfo("[WORKFLOW_FIX] packaging_lot_parent_updated", {
        entityType: "PackagingLot",
        entityId: lotId,
        task: body.lastTask ?? body.task,
        previousStatus: prevStatus,
        newStatus: String(updated.status ?? ""),
        parentUpdateSucceeded: true,
        responseSummary: { id: mapped.id, status: mapped.status }
    });
    res.json(mapped);
}));
