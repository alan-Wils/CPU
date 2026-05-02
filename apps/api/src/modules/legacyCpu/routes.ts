/**
 * Legacy HTTP paths expected by the Next.js SPA (`lib/*Api.ts`).
 * Railway runs `@cpu/api` (Prisma + workflow); these routes bridge to WorkflowService
 * so task completion persists `*UiState` JSON on parent rows.
 */
import { Router } from "express";
import { Prisma, SourceMaterialRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { requireRole } from "../../middleware/rbac.js";
import { WorkflowService } from "../../services/workflowService.js";
import { StoreService } from "../../services/storeService.js";
import { logInfo } from "../../lib/logger.js";
import { AppError } from "../../errors/AppError.js";
export const legacyCpuRouter = Router();
const workflowService = new WorkflowService();
const storeService = new StoreService();
function snapshotForStoreSave(snap) {
    return {
        cultivationBatches: snap.cultivationBatches ?? [],
        completedCultivationBatches: snap.completedCultivationBatches ?? [],
        dryFlowerBatches: snap.dryFlowerBatches ?? [],
        productionBatches: snap.productionBatches ?? [],
        sourceBatches: snap.sourceBatches ?? [],
        completedSourceBatches: snap.completedSourceBatches ?? [],
        extractionBatches: snap.extractionBatches ?? [],
        packagingBatches: snap.packagingBatches ?? [],
        inProgressPackagingBatches: snap.inProgressPackagingBatches ?? [],
        completedPackagingBatches: snap.completedPackagingBatches ?? [],
        logs: snap.logs ?? []
    };
}
function mapSourcePackageToLegacyBatch(p) {
    const batch = p.sourceChain?.cultivationBatch;
    const typeMap = {
        A_GRADE_FLOWER: "A Grade Flower",
        POPCORN: "Popcorn",
        DRY_TRIM: "Dry Trim",
        FRESH_FROZEN: "Fresh Frozen"
    };
    return {
        id: p.id,
        name: p.canonicalName,
        type: typeMap[p.role] || p.role,
        source: p.sourceChain.cultivationBatchId,
        strain: batch?.strain ?? "",
        status: "Available for Extraction",
        amount: "",
        grams: 0,
        bundles: 0
    };
}
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
/** Prisma JsonValue includes arrays; SPA ui state is always a plain object. */
function asUiRecord(value: unknown): Record<string, unknown> {
    if (value === null || value === undefined)
        return {};
    if (typeof value !== "object" || Array.isArray(value))
        return {};
    return value as Record<string, unknown>;
}
function mergeRecord(base: unknown, patch: unknown): Record<string, unknown> {
    return { ...asUiRecord(base), ...asUiRecord(patch) };
}
function mapCultivationRowToLegacy(batch) {
    const ui = asUiRecord(batch.cultivationUiState);
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
/** Matches operational deriveStrainAcronym for clone batches without acronym. */
function legacyDeriveAcronym(strain) {
    const parts = String(strain || "").trim().split(/\s+/).filter(Boolean);
    const raw = (parts.length ? parts : [strain])
        .map((p) => p[0] ?? "")
        .join("")
        .toUpperCase();
    return (raw.length > 0 ? raw : "X").slice(0, 6);
}
function gFixed(n) {
    return Number(Number(n).toFixed(4));
}
/**
 * SPA uses human-readable ids (e.g. GRCR.050226). Prisma defaults to cuid; legacy POST/PUT
 * materialize those rows with the same string primary key plus required operational children.
 */
async function createLegacyCultivationShell(companyId, actorUserId, batchId, body) {
    const strain = String(body.strain ?? "").trim().slice(0, 80);
    if (!strain) {
        throw new AppError("Strain is required to create cultivation batch", 400);
    }
    const rawAc = String(body.acronym ?? "").trim().toUpperCase();
    const strainAcronym = (rawAc.length > 0 ? rawAc : legacyDeriveAcronym(strain)).slice(0, 6);
    let plantedAt = new Date();
    if (body.cloneDate) {
        const d = new Date(String(body.cloneDate));
        if (!Number.isNaN(d.getTime()))
            plantedAt = d;
    }
    else if (body.plantedAt) {
        const d = new Date(String(body.plantedAt));
        if (!Number.isNaN(d.getTime()))
            plantedAt = d;
    }
    const gram = 0.25;
    const total = gram * 4;
    const chainKey = `SPA-${batchId.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 100)}`;
    const batchChainCode = `LG${String(batchId).replace(/[^a-zA-Z0-9]/g, "").slice(-28)}`.slice(0, 40) || "LG1";
    const initialUi = mergeRecord({}, body);
    if (initialUi.id)
        delete initialUi.id;
    await prisma.$transaction(async (tx) => {
        const batch = await tx.cultivationBatch.create({
            data: {
                id: batchId,
                companyId,
                strain,
                strainAcronym,
                batchChainCode,
                plantedAt,
                expectedYieldGrams: total,
                aGradeFlowerGrams: gFixed(gram),
                popcornGrams: gFixed(gram),
                trimGrams: gFixed(gram),
                freshFrozenGrams: gFixed(gram),
                cultivationUiState: initialUi as Prisma.InputJsonValue
            }
        });
        const chain = await tx.sourceChain.create({
            data: {
                companyId,
                cultivationBatchId: batch.id,
                chainKey
            }
        });
        const suffix = `${strainAcronym}-${batchChainCode}`;
        const seedPackages = [
            { role: SourceMaterialRole.A_GRADE_FLOWER, tag: "AG" },
            { role: SourceMaterialRole.POPCORN, tag: "PC" },
            { role: SourceMaterialRole.DRY_TRIM, tag: "DT" },
            { role: SourceMaterialRole.FRESH_FROZEN, tag: "FF" }
        ];
        for (const pkg of seedPackages) {
            await tx.sourcePackage.create({
                data: {
                    sourceChainId: chain.id,
                    role: pkg.role,
                    canonicalName: `${suffix}-${pkg.tag}`.slice(0, 120)
                }
            });
        }
        await tx.trimFlowState.create({
            data: { companyId, cultivationBatchId: batch.id, toExtractionGrams: 0, consumedGrams: 0 }
        });
        await tx.freshFrozenAllocation.create({
            data: { companyId, cultivationBatchId: batch.id, toExtractionGrams: 0 }
        });
    });
    logInfo("[WORKFLOW_FIX] legacy_cultivation_shell_created", {
        entityType: "CultivationBatch",
        entityId: batchId,
        strain,
        strainAcronym
    });
}
const cultivationWriteRoles = [
    "OWNER",
    "ADMIN",
    "OPERATIONS_MANAGER",
    "CULTIVATION_SPECIALIST"
];
legacyCpuRouter.post("/cultivation", requireRole(cultivationWriteRoles), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const body = req.body || {};
    const batchId = String(body.id || "").trim();
    if (!batchId) {
        throw new AppError("Batch id is required", 400);
    }
    const hit = await prisma.cultivationBatch.findFirst({ where: { id: batchId, companyId } });
    if (hit) {
        throw new AppError("Cultivation batch already exists", 409);
    }
    await createLegacyCultivationShell(companyId, req.auth.userId, batchId, body);
    const row = await prisma.cultivationBatch.findFirst({ where: { id: batchId, companyId } });
    if (!row) {
        throw new AppError("Cultivation batch create failed", 500);
    }
    res.status(201).json(mapCultivationRowToLegacy(row));
}));
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
legacyCpuRouter.put("/cultivation/:batchId", requireRole(cultivationWriteRoles), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const batchId = String(req.params.batchId || "");
    const body = req.body || {};
    let existing = await prisma.cultivationBatch.findFirst({ where: { id: batchId, companyId } });
    if (!existing) {
        await createLegacyCultivationShell(companyId, req.auth.userId, batchId, body);
        existing = await prisma.cultivationBatch.findFirst({ where: { id: batchId, companyId } });
        if (!existing) {
            throw new AppError("Cultivation batch not found after create", 500);
        }
        logInfo("[WORKFLOW_FIX] legacy_cultivation_materialized_on_put", { entityType: "CultivationBatch", entityId: batchId });
    }
    const prevUi: Record<string, unknown> = asUiRecord(existing.cultivationUiState);
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
        cultivationUiState: mergedUi as Prisma.InputJsonValue
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
/** Matches `workflowRouter.delete("/cultivation-batches/:batchId")` — OWNER/ADMIN only. */
const cultivationDeleteRoles = ["OWNER", "ADMIN"];
legacyCpuRouter.delete("/cultivation/:batchId", requireRole(cultivationDeleteRoles), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const batchId = String(req.params.batchId || "");
    const out = await workflowService.deleteCultivation(companyId, req.auth.userId, batchId);
    logInfo("[WORKFLOW_FIX] legacy_cultivation_deleted", { entityType: "CultivationBatch", entityId: batchId });
    res.json(out);
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
const sourceBatchWriteRoles = [
    "OWNER",
    "ADMIN",
    "OPERATIONS_MANAGER",
    "CULTIVATION_SPECIALIST",
    "EXTRACTION_SPECIALIST"
];
legacyCpuRouter.get("/source-batches", asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const snap = await storeService.load(companyId);
    const fromStore = Array.isArray(snap.sourceBatches) ? snap.sourceBatches : [];
    const pkgRows = await prisma.sourcePackage.findMany({
        where: { sourceChain: { companyId } },
        include: { sourceChain: { include: { cultivationBatch: true } } },
        orderBy: { createdAt: "desc" },
        take: 300
    });
    const derived = pkgRows.map(mapSourcePackageToLegacyBatch);
    const byId = new Map();
    for (const row of derived)
        byId.set(String(row.id), row);
    for (const row of fromStore)
        byId.set(String(row?.id || ""), row);
    res.json([...byId.values()].filter((row) => Boolean(row?.id)));
}));
legacyCpuRouter.post("/source-batches", requireRole(sourceBatchWriteRoles), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const body = req.body || {};
    const id = String(body.id || "").trim();
    if (!id) {
        throw new AppError("Source batch id is required", 400);
    }
    const snap = await storeService.load(companyId);
    const base = snapshotForStoreSave(snap);
    const current = Array.isArray(base.sourceBatches) ? [...base.sourceBatches] : [];
    const idx = current.findIndex((b) => String(b?.id || "") === id);
    if (idx >= 0)
        current[idx] = { ...current[idx], ...body };
    else
        current.unshift(body);
    base.sourceBatches = current;
    await storeService.save(companyId, req.auth.userId, base);
    logInfo("[WORKFLOW_FIX] legacy_source_batch_saved", { entityType: "LegacySourceBatch", entityId: id });
    res.status(201).json(body);
}));
legacyCpuRouter.put("/source-batches/:id", requireRole(sourceBatchWriteRoles), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const id = String(req.params.id || "").trim();
    const body = req.body || {};
    const snap = await storeService.load(companyId);
    const base = snapshotForStoreSave(snap);
    const current = Array.isArray(base.sourceBatches) ? [...base.sourceBatches] : [];
    const idx = current.findIndex((b) => String(b?.id || "") === id);
    if (idx < 0) {
        throw new AppError("Source batch not found", 404);
    }
    current[idx] = { ...current[idx], ...body, id: current[idx].id };
    base.sourceBatches = current;
    await storeService.save(companyId, req.auth.userId, base);
    res.json(current[idx]);
}));
legacyCpuRouter.delete("/source-batches/:id", requireRole(["OWNER", "ADMIN"]), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const id = String(req.params.id || "").trim();
    const snap = await storeService.load(companyId);
    const base = snapshotForStoreSave(snap);
    base.sourceBatches = (base.sourceBatches || []).filter((b) => String(b?.id || "") !== id);
    await storeService.save(companyId, req.auth.userId, base);
    res.json({ ok: true });
}));
