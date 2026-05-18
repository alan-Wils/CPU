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
import { TaskService } from "../../services/taskService.js";
import { StrainMetricsService } from "../../services/strainMetricsService.js";
import { ConfigService } from "../../services/configService.js";
import { logInfo } from "../../lib/logger.js";
import { memoizedReadWithMeta, invalidateMemoPrefix } from "../../lib/requestMemoCache.js";
import { logSlowRequestIfNeeded } from "../../lib/slowRequestLog.js";
import { taskLogToListRow } from "../../lib/taskLogListDto.js";
import {
    prismaSourcePackageToListRow,
    storeSourceBatchToListRow,
} from "../../lib/sourceBatchListDto.js";
import { AppError } from "../../errors/AppError.js";
import { validate } from "../../middleware/validate.js";
import { cultivationMotherPlantsPutSchema } from "../../validation/schemas.js";
export const legacyCpuRouter = Router();
const workflowService = new WorkflowService();
const storeService = new StoreService();
const taskService = new TaskService();
const strainMetricsService = new StrainMetricsService();
const configService = new ConfigService();
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
const SOURCE_BATCH_TYPE_MAP = {
    A_GRADE_FLOWER: "A Grade Flower",
    POPCORN: "Popcorn",
    DRY_TRIM: "Dry Trim",
    FRESH_FROZEN: "Fresh Frozen",
};
function mapSourcePackageToLegacyBatch(p, opts) {
    const summary = Boolean(opts && opts.summary);
    const batch = p.sourceChain?.cultivationBatch;
    const base = {
        id: p.id,
        name: p.canonicalName,
        type: SOURCE_BATCH_TYPE_MAP[p.role] || p.role,
        source: p.sourceChain.cultivationBatchId,
        strain: batch?.strain ?? "",
        status: "Available for Extraction",
    };
    return {
        ...base,
        amount: "",
        grams: 0,
        bundles: 0,
    };
}
function mapStoreSourceBatchSummary(row) {
    const r = row && typeof row === "object" ? row : {};
    return {
        id: String(r.id || "").trim(),
        name: String(r.name ?? r.id ?? "").trim(),
        type: String(r.type ?? "").trim(),
        source: String(r.source ?? "").trim(),
        strain: String(r.strain ?? "").trim(),
        status: String(r.status ?? "").trim(),
        ...(r.amount !== undefined && r.amount !== null ? { amount: String(r.amount) } : {}),
        ...(r.grams !== undefined && r.grams !== null ? { grams: Number(r.grams) || 0 } : {}),
        ...(r.bundles !== undefined && r.bundles !== null ? { bundles: Number(r.bundles) || 0 } : {}),
    };
}
function isLikelyPrismaSourcePackageId(id) {
    const s = String(id || "").trim();
    if (!s)
        return false;
    return /^c[a-z0-9]{20,}$/i.test(s) || (!s.includes("-") && s.length >= 22);
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
    const nested = body.data && typeof body.data === "object" ? { ...body.data } : {};
    const source = body.source ?? nested.source ?? null;
    const linkedBatch = body.linkedBatch ?? nested.linkedBatch ?? null;
    return JSON.stringify({
        area: body.area ?? "System",
        batch: body.batch ?? null,
        task: body.task ?? "Log",
        output: body.output ?? "",
        data: nested,
        source,
        linkedBatch
    });
}
function compactTaskLogData(data) {
    if (!data || typeof data !== "object" || Array.isArray(data))
        return {};
    const o = data;
    const pick = {};
    for (const k of ["loggedAt", "loggedAtIso", "source", "linkedBatch", "people", "minutes", "strain", "room", "stage"]) {
        if (o[k] !== undefined && o[k] !== null && o[k] !== "")
            pick[k] = o[k];
    }
    return pick;
}
/** @param {object} row @param {{ compact?: boolean }} [opts] */
function taskRowToLegacyLog(row, opts) {
    const compact = Boolean(opts && opts.compact);
    const raw = String(row.note || "");
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && "task" in parsed) {
            const dataRaw = typeof parsed.data === "object" && parsed.data ? parsed.data : {};
            const data = compact ? compactTaskLogData(dataRaw) : { ...dataRaw };
            const loggedAtIso = row.createdAt.toISOString();
            const src =
                parsed.source ??
                (typeof data.source === "string" && data.source ? data.source : undefined);
            const linked =
                parsed.linkedBatch ??
                (typeof data.linkedBatch === "string" && data.linkedBatch
                    ? data.linkedBatch
                    : undefined);
            const out: Record<string, unknown> = {
                id: row.id,
                actorUserId: row.actorUserId,
                area: parsed.area ?? "System",
                batch: parsed.batch ?? row.referenceId ?? "",
                task: parsed.task ?? "Log",
                output: compact ? "" : (parsed.output ?? ""),
                people: data.people ?? "",
                minutes: String(data.minutes ?? row.minutes ?? ""),
                source: src,
                linkedBatch: linked,
                time: row.createdAt.toISOString(),
                loggedAt: row.createdAt.toISOString(),
                loggedAtIso,
            };
            if (!compact) {
                out.data = { ...data, loggedAt: data.loggedAt ?? row.createdAt.toISOString(), loggedAtIso };
            }
            else if (Object.keys(data).length > 0) {
                out.data = data;
            }
            return out;
        }
    }
    catch {
        /* fall through */
    }
    const stage = String(row.stage || "");
    const area = stage === "EXTRACTION" ? "Extraction" : stage === "PACKAGING" ? "Packaging" : "Cultivation";
    return {
        id: row.id,
        actorUserId: row.actorUserId,
        area,
        batch: row.referenceId ?? "",
        task: "Task",
        output: raw,
        people: "",
        minutes: String(row.minutes ?? ""),
        data: {},
        time: row.createdAt.toISOString(),
        loggedAt: row.createdAt.toISOString(),
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
function extractionTaskNodeIsEmpty(value: unknown): boolean {
    if (value === undefined || value === null)
        return true;
    if (Array.isArray(value))
        return value.length === 0;
    if (typeof value === "object")
        return Object.keys(value as Record<string, unknown>).length === 0;
    return false;
}
/** Per-task merge: never replace a non-empty node with an empty object (common JSON partial). */
function mergeExtractionTaskDataMaps(
    tdStore: Record<string, unknown>,
    tdDb: Record<string, unknown>
): Record<string, unknown> {
    const keys = new Set([...Object.keys(tdStore), ...Object.keys(tdDb)]);
    const out: Record<string, unknown> = {};
    for (const k of keys) {
        const a = tdStore[k];
        const b = tdDb[k];
        if (extractionTaskNodeIsEmpty(b) && !extractionTaskNodeIsEmpty(a)) {
            out[k] = a;
        }
        else if (extractionTaskNodeIsEmpty(a) && !extractionTaskNodeIsEmpty(b)) {
            out[k] = b;
        }
        else if (typeof a === "object" && typeof b === "object" && a && b && !Array.isArray(a) && !Array.isArray(b)) {
            out[k] = { ...(a as Record<string, unknown>), ...(b as Record<string, unknown>) };
        }
        else {
            out[k] = !extractionTaskNodeIsEmpty(b) ? b : a;
        }
    }
    return out;
}
/** Merge company-store snapshot into a DB-backed extraction row without losing newer task progress. */
function mergeExtractionLegacyRow(
    fromDb: Record<string, unknown>,
    fromStore: Record<string, unknown>
): Record<string, unknown> {
    const db = asUiRecord(fromDb);
    const st = asUiRecord(fromStore);
    const tdDb = asUiRecord(db.taskData);
    const tdSt = asUiRecord(st.taskData);
    const taskData = mergeExtractionTaskDataMaps(tdSt, tdDb);
    const ctDb = Array.isArray(db.completedTasks) ? (db.completedTasks as unknown[]).map(String) : [];
    const ctSt = Array.isArray(st.completedTasks) ? (st.completedTasks as unknown[]).map(String) : [];
    const completedTasks = [...ctDb, ...ctSt.filter((t) => !ctDb.includes(t))];
    return {
        ...st,
        ...db,
        taskData,
        completedTasks
    };
}
/** SPA source row id → cultivation batch id from company store snapshot. */
function cultivationIdFromSourceRowInSnap(sourceId: string, snap: unknown): string | null {
    const list = Array.isArray((snap as { sourceBatches?: unknown })?.sourceBatches)
        ? (snap as { sourceBatches: unknown[] }).sourceBatches
        : [];
    const fromStore = list.find((s) => String((s as { id?: unknown })?.id) === String(sourceId));
    if (!fromStore || typeof fromStore !== "object")
        return null;
    const row = fromStore as {
        source?: unknown;
        parentCultivationBatch?: unknown;
        cultivationBatchId?: unknown;
    };
    const cid = row.source ?? row.parentCultivationBatch ?? row.cultivationBatchId;
    return cid != null && String(cid).length > 0 ? String(cid) : null;
}
type ExtractionCultivationResolution = {
    cultivationBatchId: string;
    /** Distinct cultivation batches tied to the selected sources (order preserved). */
    blendCultivationBatchIds: string[];
};
/**
 * ExtractionRun keeps one FK (`cultivationBatchId`). For multi-batch blends we pick an anchor id
 * (optional `primaryCultivationBatchId` on the body, else first source's batch) and persist the
 * full list in `extractionUiState.blendCultivationBatchIds` at create time.
 */
async function resolveCultivationBatchIdForExtractionCreate(companyId: string, body: Record<string, unknown>, snap: unknown): Promise<ExtractionCultivationResolution> {
    const direct = String(body.cultivationBatchId ?? "").trim();
    if (direct) {
        const row = await prisma.cultivationBatch.findFirst({
            where: { id: direct, companyId }
        });
        if (row) {
            return { cultivationBatchId: direct, blendCultivationBatchIds: [direct] };
        }
    }
    const sources = Array.isArray(body.sources) ? body.sources : [];
    if (sources.length === 0) {
        throw new AppError("At least one source or cultivationBatchId is required", 400);
    }
    const ids: string[] = [];
    for (const row of sources) {
        const r = row && typeof row === "object" ? (row as { sourceId?: unknown }) : {};
        const sid = String(r.sourceId ?? "").trim();
        if (!sid) {
            throw new AppError("Each source row must have sourceId", 400);
        }
        const fromSnap = cultivationIdFromSourceRowInSnap(sid, snap);
        if (fromSnap) {
            ids.push(fromSnap);
            continue;
        }
        const pack = await prisma.sourcePackage.findFirst({
            where: { id: sid, sourceChain: { companyId } },
            include: { sourceChain: true }
        });
        if (pack?.sourceChain?.cultivationBatchId) {
            ids.push(pack.sourceChain.cultivationBatchId);
            continue;
        }
        throw new AppError(`Could not resolve cultivation batch for source ${sid}`, 400);
    }
    const blendCultivationBatchIds = [...new Set(ids)];
    let cultivationBatchId = blendCultivationBatchIds[0];
    if (blendCultivationBatchIds.length > 1) {
        const preferred = String(body.primaryCultivationBatchId ?? "").trim();
        if (preferred && blendCultivationBatchIds.includes(preferred)) {
            cultivationBatchId = preferred;
        }
        logInfo("[EXTRACTION_CREATE] multi_cultivation_blend", {
            companyId,
            anchorCultivationBatchId: cultivationBatchId,
            blendCultivationBatchIds
        });
    }
    for (const cid of blendCultivationBatchIds) {
        const batchRow = await prisma.cultivationBatch.findFirst({
            where: { id: cid, companyId }
        });
        if (!batchRow) {
            throw new AppError(`Cultivation batch not found for extraction: ${cid}`, 404);
        }
    }
    return { cultivationBatchId, blendCultivationBatchIds };
}
const extractionWriteRoles = [
    "OWNER",
    "ADMIN",
    "OPERATIONS_MANAGER",
    "EXTRACTION_SPECIALIST"
];
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
    const ui = asUiRecord(run.extractionUiState);
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
    const ui = asUiRecord(lot.packagingUiState);
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
    const rawTake = req.query.take ?? req.query.limit;
    const parsed = typeof rawTake === "string" ? Number.parseInt(rawTake, 10) : Number(rawTake);
    const take = Number.isFinite(parsed) ? Math.min(500, Math.max(1, Math.floor(parsed))) : 50;
    const compact =
        String(req.query.compact ?? "1").trim() !== "0"
        && String(req.query.compact ?? "").trim() !== "false";
    const paginated =
        String(req.query.paginated ?? "").trim() === "1"
        || String(req.query.paginated ?? "").trim() === "true";
    const cursorRaw = String(req.query.cursor ?? "").trim();
    const cursorDate = cursorRaw ? new Date(cursorRaw) : null;
    const cursorValid = cursorDate && !Number.isNaN(cursorDate.getTime());

    const rows = await prisma.taskLog.findMany({
        where: {
            companyId,
            ...(cursorValid ? { createdAt: { lt: cursorDate } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: take + 1,
    });
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const items = compact
        ? page.map((r) => taskLogToListRow(r))
        : page.map((r) => taskRowToLegacyLog(r, { compact: false }));
    const nextCursor = hasMore && page.length ? page[page.length - 1].createdAt.toISOString() : null;

    res.setHeader("Cache-Control", "private, max-age=20");
    if (paginated) {
        res.json({ items, nextCursor, hasMore });
        return;
    }
    const body = JSON.stringify(items);
    logSlowRequestIfNeeded({
        label: "GET /api/logs",
        companyId,
        payloadBytes: Buffer.byteLength(body, "utf8"),
        rowCount: items.length,
        extra: { compact, paginated },
    });
    res.type("json").send(body);
}));
/** Compact latest task log for realtime “peer task” UI toasts (SPA poll). */
legacyCpuRouter.get("/logs/latest-live", asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const cacheKey = `legacy:logs:latest-live:${companyId}`;
    const payload = await memoizedReadWithMeta(cacheKey, 4_000, async () => {
        const row = await prisma.taskLog.findFirst({
            where: { companyId },
            orderBy: { createdAt: "desc" },
        });
        if (!row)
            return null;
        const legacy = taskRowToLegacyLog(row, { compact: true });
        const actor = await prisma.user.findUnique({
            where: { id: row.actorUserId },
            select: { email: true },
        });
        return {
            id: row.id,
            createdAt: row.createdAt.toISOString(),
            actorUserId: row.actorUserId,
            actorEmail: actor?.email ?? null,
            area: legacy.area,
            task: legacy.task,
        };
    });
    res.setHeader("Cache-Control", "private, max-age=3");
    res.json(payload.value);
}));
/** Full task log payload (list endpoint defaults to compact rows). */
legacyCpuRouter.get("/logs/:taskLogId", asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const taskLogId = String(req.params.taskLogId || "").trim();
    if (!taskLogId)
        throw new AppError("Invalid task log id", 400);
    const row = await prisma.taskLog.findFirst({
        where: { id: taskLogId, companyId },
    });
    if (!row)
        throw new AppError("Task log not found", 404);
    res.setHeader("Cache-Control", "private, max-age=30");
    res.json(taskRowToLegacyLog(row, {}));
}));
/** SPA `lib/logsApi.deleteAllLogs` — must be registered before `DELETE /logs/:id`. */
legacyCpuRouter.delete("/logs/all/clear", asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const out = await taskService.deleteAll({
        companyId,
        actorUserId: req.auth.userId,
        role: req.auth.role
    });
    logInfo("[WORKFLOW_FIX] legacy_task_logs_cleared", { entityType: "TaskLog", entityId: "ALL" });
    res.json(out);
}));
legacyCpuRouter.delete("/logs/:taskLogId", asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const taskLogId = String(req.params.taskLogId || "").trim();
    const out = await taskService.deleteById({
        companyId,
        actorUserId: req.auth.userId,
        role: req.auth.role,
        taskLogId
    });
    logInfo("[WORKFLOW_FIX] legacy_task_log_deleted", { entityType: "TaskLog", entityId: taskLogId });
    res.json(out);
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
    res.status(201).json(taskRowToLegacyLog(row, {}));
}));
/** SPA cultivation labor: close pending end time (cultivation writers) or manager-edit labor fields. */
legacyCpuRouter.patch("/logs/:taskLogId", asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const taskLogId = String(req.params.taskLogId || "").trim();
    const body = req.body || {};
    const row = await prisma.taskLog.findFirst({
        where: { id: taskLogId, companyId }
    });
    if (!row) {
        throw new AppError("Log not found", 404);
    }
    const raw = String(row.note || "");
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new AppError("Log cannot be edited (unparseable note)", 400);
    }
    if (!parsed || typeof parsed !== "object") {
        throw new AppError("Log cannot be edited", 400);
    }
    const existingData = parsed.data && typeof parsed.data === "object" ? { ...parsed.data } : {};
    const closeLabor = body.closeLaborPendingEnd === true;
    const userRole = String(req.auth?.role || "").toUpperCase();
    const canClose = [
        "CULTIVATION",
        "CULTIVATION_SPECIALIST",
        "MANAGER",
        "OPERATIONS_MANAGER",
        "ADMIN",
        "OWNER"
    ].includes(userRole);
    const canManagerEdit = ["MANAGER", "OPERATIONS_MANAGER", "ADMIN", "OWNER"].includes(userRole);
    if (closeLabor) {
        if (!canClose) {
            throw new AppError("Your role cannot close open labor entries", 403);
        }
        if (!existingData.laborPendingEnd) {
            throw new AppError("This log is not waiting for an end time", 400);
        }
        const patch = body.data && typeof body.data === "object" ? body.data : {};
        if (!patch.taskEndTime) {
            throw new AppError("End time is required to close this labor entry", 400);
        }
        const total = Number(patch.totalLaborMinutes);
        if (!Number.isFinite(total) || total <= 0) {
            throw new AppError("Closed labor must have a positive total person-minutes value", 400);
        }
        if (patch.laborPendingEnd === true) {
            throw new AppError("Labor cannot stay in pending state when closing", 400);
        }
        const nextData = { ...existingData, ...patch, laborPendingEnd: false };
        const nextOutput = body.output !== undefined ? String(body.output) : parsed.output;
        const nextNote = JSON.stringify({
            ...parsed,
            output: nextOutput,
            data: nextData
        });
        const perPersonMin = Number(nextData.minutes);
        const rowMinutes = safeMinutes(Number.isFinite(perPersonMin) && perPersonMin > 0 ? perPersonMin : total);
        await prisma.taskLog.update({
            where: { id: row.id },
            data: { note: nextNote, minutes: rowMinutes }
        });
        const updated = await prisma.taskLog.findFirst({ where: { id: row.id } });
        if (!updated) {
            throw new AppError("Log update failed", 500);
        }
        res.json(taskRowToLegacyLog(updated, {}));
        return;
    }
    if (!canManagerEdit) {
        throw new AppError("Only Managers (and above) can edit saved labor on a task log", 403);
    }
    const patch = body.data && typeof body.data === "object" ? body.data : null;
    if (!patch && body.output === undefined) {
        throw new AppError("Nothing to update", 400);
    }
    const nextData = patch ? { ...existingData, ...patch } : existingData;
    const nextOutput = body.output !== undefined ? String(body.output) : parsed.output;
    const nextNote = JSON.stringify({
        ...parsed,
        output: nextOutput,
        data: nextData
    });
    const perPersonMin = Number(nextData.minutes);
    const totalLm = Number(nextData.totalLaborMinutes);
    const rowMinutes = safeMinutes(Number.isFinite(perPersonMin) && perPersonMin > 0
        ? perPersonMin
        : Number.isFinite(totalLm) && totalLm > 0
            ? totalLm
            : row.minutes);
    await prisma.taskLog.update({
        where: { id: row.id },
        data: { note: nextNote, minutes: rowMinutes }
    });
    const updated = await prisma.taskLog.findFirst({ where: { id: row.id } });
    if (!updated) {
        throw new AppError("Log update failed", 500);
    }
    res.json(taskRowToLegacyLog(updated, {}));
}));
function readMotherPlantsFromCultivationConfig(value: unknown): unknown[] {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return [];
    const mp = (value as Record<string, unknown>).motherPlants;
    return Array.isArray(mp) ? mp : [];
}

legacyCpuRouter.get("/cultivation/mothers", asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const rows = await configService.list(companyId);
    const cultRow = rows.find((r) => r.key === "cultivation");
    const motherPlants = readMotherPlantsFromCultivationConfig(cultRow?.value);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ motherPlants });
}));

legacyCpuRouter.put("/cultivation/mothers", requireRole(cultivationWriteRoles), validate({ body: cultivationMotherPlantsPutSchema }), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const body = req.body as { motherPlants: unknown[] };
    const rows = await configService.list(companyId);
    const cultRow = rows.find((r) => r.key === "cultivation");
    const prev = cultRow?.value && typeof cultRow.value === "object" && !Array.isArray(cultRow.value)
        ? { ...(cultRow.value as Record<string, unknown>) }
        : {};
    const merged = { ...prev, motherPlants: body.motherPlants };
    await configService.upsert({
        companyId,
        actorUserId: req.auth.userId,
        key: "cultivation",
        value: merged,
    });
    res.json({ motherPlants: body.motherPlants });
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
/** Manual / cron-friendly recomputation of strain auto averages into `CompanyConfig.cultivation` (also runs after potency-changing PUTs). */
legacyCpuRouter.post("/cultivation/strain-metrics/recompute", requireRole(cultivationWriteRoles), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    await strainMetricsService.recomputeStrainAutoMetricsForCompany({
        companyId,
        actorUserId: req.auth.userId
    });
    res.json({ ok: true });
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
    const prevPctN = Number(prevUi.finalLabPotencyPct);
    const nextPctN = Number(mergedUi.finalLabPotencyPct);
    const nextOk = Number.isFinite(nextPctN);
    const prevOk = Number.isFinite(prevPctN);
    if (nextOk && (!prevOk || prevPctN !== nextPctN)) {
        try {
            await strainMetricsService.recomputeStrainAutoMetricsForCompany({
                companyId,
                actorUserId: req.auth.userId
            });
        }
        catch (err) {
            logInfo("[STRAIN_METRICS] rollup_failed", { companyId, message: String(err) });
        }
    }
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
    const snap = await storeService.load(companyId);
    const rows = await prisma.extractionRun.findMany({
        where: { companyId },
        orderBy: { updatedAt: "desc" },
        take: 200
    });
    const fromDb = rows.map(mapExtractionRunToLegacy);
    const byId = new Map();
    for (const row of fromDb) {
        const id = String(row?.id || "").trim();
        if (id)
            byId.set(id, row);
    }
    const fromStore = Array.isArray(snap.extractionBatches) ? snap.extractionBatches : [];
    for (const row of fromStore) {
        const id = String(row?.id || "").trim();
        if (!id)
            continue;
        const prev = byId.get(id);
        // DB is authoritative for extraction run existence; do not rehydrate ghost rows
        // from legacy company-store snapshots (those rows 404 on delete/update).
        if (!prev)
            continue;
        byId.set(id, mergeExtractionLegacyRow(asUiRecord(prev), asUiRecord(row)));
    }
    res.json([...byId.values()]);
}));
legacyCpuRouter.post("/extraction", requireRole(extractionWriteRoles), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const body = asUiRecord(req.body);
    const customId = String(body.id ?? "").trim();
    if (!customId) {
        throw new AppError("Extraction batch id is required", 400);
    }
    const dup = await prisma.extractionRun.findFirst({ where: { id: customId, companyId } });
    if (dup) {
        throw new AppError("Extraction batch already exists", 409);
    }
    const snap = await storeService.load(companyId);
    const resolved = await resolveCultivationBatchIdForExtractionCreate(companyId, body, snap);
    const mergedUi = mergeRecord({}, body);
    if (mergedUi.id)
        delete mergedUi.id;
    if (resolved.blendCultivationBatchIds.length > 1) {
        mergedUi.blendCultivationBatchIds = resolved.blendCultivationBatchIds;
        mergedUi.blendCultivationAnchorId = resolved.cultivationBatchId;
    }
    const run = await prisma.extractionRun.create({
        data: {
            id: customId,
            companyId,
            cultivationBatchId: resolved.cultivationBatchId,
            phase: "PENDING_BIOMASS_PREP",
            method: "",
            extractionUiState: mergedUi as Prisma.InputJsonValue
        }
    });
    logInfo("[WORKFLOW_FIX] extraction_run_legacy_created", {
        entityType: "ExtractionRun",
        entityId: run.id,
        cultivationBatchId: resolved.cultivationBatchId,
        blendCount: resolved.blendCultivationBatchIds.length
    });
    res.status(201).json(mapExtractionRunToLegacy(run));
}));
legacyCpuRouter.put("/extraction/:runId", requireRole(extractionWriteRoles), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const runId = String(req.params.runId || "");
    const body = req.body || {};
    let existing = await prisma.extractionRun.findFirst({ where: { id: runId, companyId } });
    if (!existing) {
        const snap = await storeService.load(companyId);
        const resolved = await resolveCultivationBatchIdForExtractionCreate(companyId, asUiRecord(body), snap);
        const shellUi = mergeRecord({}, body);
        if (shellUi.id)
            delete shellUi.id;
        if (resolved.blendCultivationBatchIds.length > 1) {
            shellUi.blendCultivationBatchIds = resolved.blendCultivationBatchIds;
            shellUi.blendCultivationAnchorId = resolved.cultivationBatchId;
        }
        existing = await prisma.extractionRun.create({
            data: {
                id: runId,
                companyId,
                cultivationBatchId: resolved.cultivationBatchId,
                phase: "PENDING_BIOMASS_PREP",
                method: "",
                extractionUiState: shellUi as Prisma.InputJsonValue
            }
        });
        logInfo("[WORKFLOW_FIX] extraction_run_materialized_on_put", {
            entityType: "ExtractionRun",
            entityId: runId,
            cultivationBatchId: resolved.cultivationBatchId,
            blendCount: resolved.blendCultivationBatchIds.length
        });
    }
    const prevUi = asUiRecord(existing.extractionUiState);
    const prevPhase = String(existing.phase ?? "");
    const mergedUi = mergeRecord(prevUi, body);
    if (mergedUi.id)
        delete mergedUi.id;
    const updated = await workflowService.updateExtractionRun(companyId, req.auth.userId, {
        runId,
        method: body.method ?? existing.method,
        supplyUsed: body.supplyUsed ?? existing.supplyUsed,
        extractionUiState: mergedUi as Prisma.InputJsonValue
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
/** SPA `lib/extractionApi.deleteExtractionBatchRecord` — same path family as GET/POST/PUT. */
legacyCpuRouter.delete("/extraction/:runId", requireRole(extractionWriteRoles), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const runId = String(req.params.runId || "");
    const out = await workflowService.deleteExtractionRun(companyId, req.auth.userId, runId);
    logInfo("[WORKFLOW_FIX] legacy_extraction_deleted", { entityType: "ExtractionRun", entityId: runId });
    res.json(out);
}));
const packagingWriteRoles = [
    "OWNER",
    "ADMIN",
    "MANAGER",
    "OPERATIONS_MANAGER",
    "PACKAGING_SPECIALIST"
];
legacyCpuRouter.get("/packaging", asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const snap = await storeService.load(companyId);
    const rows = await prisma.packagingLot.findMany({
        where: { companyId },
        orderBy: { updatedAt: "desc" },
        take: 200
    });
    const fromDb = rows.map(mapPackagingLotToLegacy);
    const byId = new Map();
    for (const row of fromDb) {
        const id = String(row?.id || "").trim();
        if (id)
            byId.set(id, row);
    }
    for (const key of ["packagingBatches", "inProgressPackagingBatches", "completedPackagingBatches"]) {
        const arr = Array.isArray(snap[key]) ? snap[key] : [];
        for (const row of arr) {
            const id = String(row?.id || "").trim();
            if (!id)
                continue;
            const prev = byId.get(id);
            // DB is authoritative for packaging lot existence; do not rehydrate ghost rows
            // from legacy company-store snapshots (those rows 404 on delete/update).
            if (!prev)
                continue;
            byId.set(id, mergeRecord(asUiRecord(prev), row));
        }
    }
    res.json([...byId.values()]);
}));
legacyCpuRouter.post("/packaging", requireRole(packagingWriteRoles), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const body = asUiRecord(req.body);
    const customId = String(body.id ?? "").trim();
    if (!customId) {
        throw new AppError("Packaging lot id is required", 400);
    }
    const dup = await prisma.packagingLot.findFirst({ where: { id: customId, companyId } });
    if (dup) {
        throw new AppError("Packaging lot already exists", 409);
    }
    let extractionRunId = String(body.extractionBatchId || body.sourceBatchId || "").trim();
    if (!extractionRunId) {
        const tryId = String(body.id ?? "").trim();
        if (tryId) {
            const probe = await prisma.extractionRun.findFirst({ where: { id: tryId, companyId } });
            if (probe)
                extractionRunId = tryId;
        }
    }
    if (!extractionRunId) {
        throw new AppError("extractionBatchId (or sourceBatchId) is required to link packaging to an extraction run", 400);
    }
    const run = await prisma.extractionRun.findFirst({ where: { id: extractionRunId, companyId } });
    if (!run) {
        throw new AppError("Extraction run not found for packaging lot", 404);
    }
    const mergedUi = mergeRecord({}, body);
    if (mergedUi.id)
        delete mergedUi.id;
    const skuRaw = String(body.sku || body.name || body.productType || body.type || "PACKAGING").trim();
    const sku = skuRaw.length > 0 ? skuRaw.slice(0, 120) : "PACKAGING";
    const gTry = Number(body.gramsPerUnit);
    const gramsPerUnit = Number.isFinite(gTry) && gTry > 0 ? gTry : 1;
    const lot = await prisma.packagingLot.create({
        data: {
            id: customId,
            companyId,
            extractionRunId: run.id,
            sku,
            status: "IN_PROGRESS",
            netOutputGrams: 0,
            terpeneGrams: 0,
            units: 0,
            gramsPerUnit,
            defaultTemplate: body.defaultTemplate != null ? String(body.defaultTemplate).slice(0, 200) : null,
            packagingUiState: mergedUi as Prisma.InputJsonValue
        }
    });
    logInfo("[WORKFLOW_FIX] packaging_lot_legacy_created", {
        entityType: "PackagingLot",
        entityId: lot.id,
        extractionRunId: run.id
    });
    res.status(201).json(mapPackagingLotToLegacy(lot));
}));
legacyCpuRouter.put("/packaging/:lotId", requireRole(packagingWriteRoles), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const lotId = String(req.params.lotId || "");
    const body = req.body || {};
    const existing = await prisma.packagingLot.findFirst({ where: { id: lotId, companyId } });
    if (!existing) {
        throw new AppError("Packaging lot not found", 404);
    }
    const prevUi = asUiRecord(existing.packagingUiState);
    const prevStatus = String(existing.status ?? "");
    const mergedUi = mergeRecord(prevUi, body);
    if (mergedUi.id)
        delete mergedUi.id;
    const updated = await workflowService.updatePackagingLot(companyId, req.auth.userId, {
        lotId,
        sku: body.sku ?? existing.sku,
        gramsPerUnit: body.gramsPerUnit ?? existing.gramsPerUnit,
        defaultTemplate: body.defaultTemplate ?? existing.defaultTemplate ?? undefined,
        packagingUiState: mergedUi as Prisma.InputJsonValue
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
const packagingCompletedDeleteRoles = new Set(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "MANAGER"]);
legacyCpuRouter.delete("/packaging/:lotId", requireRole(packagingWriteRoles), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const lotId = String(req.params.lotId || "");
    const role = String(req.auth?.role || "").toUpperCase();
    const allowDeleteCompletedLots = packagingCompletedDeleteRoles.has(role);
    const out = await workflowService.deletePackagingLot(companyId, req.auth.userId, lotId, { allowDeleteCompletedLots });
    logInfo("[WORKFLOW_FIX] legacy_packaging_deleted", { entityType: "PackagingLot", entityId: lotId });
    res.json(out);
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
    const summary =
        String(req.query.summary ?? "1").trim() !== "0"
        && String(req.query.summary ?? "").trim() !== "false";
    const cacheKey = `legacy:source-batches:${companyId}:${summary ? "sum" : "full"}`;
    const ttlMs = 20_000;
    const dbStarted = Date.now();
    const { value: items, cacheHit, inflightJoined } = await memoizedReadWithMeta(cacheKey, ttlMs, async () => {
        const pkgWhere = { sourceChain: { companyId } };
        const pkgOrder = { createdAt: "desc" as const };
        const pkgTake = summary ? 120 : 300;
        const pkgRows = summary
            ? await prisma.sourcePackage.findMany({
                where: pkgWhere,
                orderBy: pkgOrder,
                take: pkgTake,
                select: {
                    id: true,
                    canonicalName: true,
                    role: true,
                    sourceChain: {
                        select: {
                            cultivationBatchId: true,
                            cultivationBatch: { select: { strain: true } },
                        },
                    },
                },
            })
            : await prisma.sourcePackage.findMany({
                where: pkgWhere,
                include: { sourceChain: { include: { cultivationBatch: true } } },
                orderBy: pkgOrder,
                take: pkgTake,
            });
        const derived = summary
            ? pkgRows.map((p) => prismaSourcePackageToListRow(p))
            : pkgRows.map((p) => mapSourcePackageToLegacyBatch(p, { summary: false }));
        const byId = new Map();
        for (const row of derived)
            byId.set(String(row.id), row);
        if (summary) {
            const fromStore = await storeService.loadSourceBatchesStoreSlice(companyId);
            let legacyAdded = 0;
            const legacyCap = 60;
            for (const row of fromStore) {
                if (legacyAdded >= legacyCap)
                    break;
                const id = String(
                    row && typeof row === "object" ? (row as { id?: unknown }).id || "" : "",
                ).trim();
                if (!id || byId.has(id) || isLikelyPrismaSourcePackageId(id))
                    continue;
                const mapped = storeSourceBatchToListRow(row);
                if (!mapped)
                    continue;
                byId.set(id, mapped);
                legacyAdded++;
            }
        }
        else {
            const snap = await storeService.load(companyId);
            const fromStore = Array.isArray(snap.sourceBatches) ? snap.sourceBatches : [];
            for (const row of fromStore) {
                const id = String(row?.id || "").trim();
                if (!id || byId.has(id) || isLikelyPrismaSourcePackageId(id))
                    continue;
                byId.set(id, row);
            }
        }
        return [...byId.values()].filter((row) => Boolean(row?.id));
    });
    const dbMs = Date.now() - dbStarted;
    const body = JSON.stringify(items);
    logSlowRequestIfNeeded({
        label: "GET /api/source-batches",
        companyId,
        dbMs,
        payloadBytes: Buffer.byteLength(body, "utf8"),
        rowCount: items.length,
        cacheHit,
        inflightJoined,
        extra: { summary },
    });
    res.setHeader("Cache-Control", "private, max-age=20");
    res.type("json").send(body);
}));
legacyCpuRouter.get("/source-batches/:id", asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const id = String(req.params.id || "").trim();
    if (!id)
        throw new AppError("Source batch id is required", 400);
    const pkg = await prisma.sourcePackage.findFirst({
        where: { id, sourceChain: { companyId } },
        include: { sourceChain: { include: { cultivationBatch: true } } },
    });
    if (pkg) {
        res.json(mapSourcePackageToLegacyBatch(pkg, { summary: false }));
        return;
    }
    const snap = await storeService.load(companyId);
    const fromStore = Array.isArray(snap.sourceBatches) ? snap.sourceBatches : [];
    const hit = fromStore.find((b) => String(b?.id || "").trim() === id);
    if (!hit)
        throw new AppError("Source batch not found", 404);
    res.json(hit);
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
    invalidateMemoPrefix(`legacy:source-batches:${companyId}:`);
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
    invalidateMemoPrefix(`legacy:source-batches:${companyId}:`);
    res.json(current[idx]);
}));
legacyCpuRouter.delete("/source-batches/:id", requireRole(sourceBatchWriteRoles), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const id = String(req.params.id || "").trim();
    if (!id) {
        throw new AppError("Source batch id is required", 400);
    }
    const snap = await storeService.load(companyId);
    const base = snapshotForStoreSave(snap);
    base.sourceBatches = (base.sourceBatches || []).filter((b) => String(b?.id || "") !== id);
    base.completedSourceBatches = (base.completedSourceBatches || []).filter((b) => String(b?.id || "") !== id);
    base.productionBatches = (base.productionBatches || []).filter((b) => String(b?.id || "") !== id);
    try {
        await workflowService.deleteSourcePackage(companyId, req.auth.userId, id);
        logInfo("[WORKFLOW_FIX] prisma_source_package_deleted", { entityType: "SourcePackage", entityId: id });
    }
    catch (error) {
        const is404 = error instanceof AppError && error.statusCode === 404;
        if (!is404)
            throw error;
    }
    await storeService.save(companyId, req.auth.userId, base);
    invalidateMemoPrefix(`legacy:source-batches:${companyId}:`);
    logInfo("[WORKFLOW_FIX] legacy_source_batch_deleted", { entityType: "LegacySourceBatch", entityId: id });
    res.json({ ok: true });
}));
