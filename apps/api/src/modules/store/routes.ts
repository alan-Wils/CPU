import { Router } from "express";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { z } from "zod";
import { StoreService } from "../../services/storeService.js";
import { memoizedReadWithMeta, invalidateMemoPrefix } from "../../lib/requestMemoCache.js";
import { logSlowRequestIfNeeded } from "../../lib/slowRequestLog.js";
const storePayloadSchema = z.object({
    cultivationBatches: z.array(z.unknown()).default([]),
    completedCultivationBatches: z.array(z.unknown()).default([]),
    dryFlowerBatches: z.array(z.unknown()).default([]),
    productionBatches: z.array(z.unknown()).default([]),
    sourceBatches: z.array(z.unknown()).default([]),
    completedSourceBatches: z.array(z.unknown()).default([]),
    extractionBatches: z.array(z.unknown()).default([]),
    packagingBatches: z.array(z.unknown()).default([]),
    inProgressPackagingBatches: z.array(z.unknown()).default([]),
    completedPackagingBatches: z.array(z.unknown()).default([]),
    logs: z.array(z.unknown()).default([])
});
export const storeRouter = Router();
const service = new StoreService();
storeRouter.get("/version", asyncHandler(async (req, res) => {
    const version = await service.getVersion(getScopedCompanyId(req));
    res.setHeader("Cache-Control", "private, max-age=5");
    res.json(version);
}));
storeRouter.get("/", asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const includeLogs =
        String(req.query.includeLogs ?? "").trim() === "1"
        || String(req.query.include ?? "").split(",").map((s) => s.trim()).includes("logs");
    const cacheKey = `store:snapshot:${companyId}:${includeLogs ? "logs" : "nologs"}`;
    const dbStarted = Date.now();
    const { value: data, cacheHit, inflightJoined } = await memoizedReadWithMeta(cacheKey, 15_000, () =>
        service.load(companyId, { includeLogs }),
    );
    const dbMs = Date.now() - dbStarted;
    const body = JSON.stringify(data);
    logSlowRequestIfNeeded({
        label: "GET /api/store",
        companyId,
        dbMs,
        payloadBytes: Buffer.byteLength(body, "utf8"),
        cacheHit,
        inflightJoined,
    });
    res.setHeader("Cache-Control", "private, max-age=15");
    res.type("json").send(body);
}));
const saveStack = [
    validate({ body: storePayloadSchema }),
    asyncHandler(async (req, res) => {
        const companyId = getScopedCompanyId(req);
        const data = await service.save(companyId, req.auth.userId, req.body);
        invalidateMemoPrefix(`store:snapshot:${companyId}:`);
        res.json(data);
    })
];
storeRouter.put("/", ...saveStack);
/** Legacy Node backend used POST on `/api/sync`. */
storeRouter.post("/", ...saveStack);
