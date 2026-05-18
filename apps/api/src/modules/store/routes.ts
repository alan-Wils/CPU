import { Router } from "express";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { z } from "zod";
import { StoreService } from "../../services/storeService.js";
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
    const includeLogs =
        String(req.query.includeLogs ?? "").trim() === "1"
        || String(req.query.include ?? "").split(",").map((s) => s.trim()).includes("logs");
    const data = await service.load(getScopedCompanyId(req), { includeLogs });
    res.setHeader("Cache-Control", "private, max-age=15");
    res.json(data);
}));
const saveStack = [
    validate({ body: storePayloadSchema }),
    asyncHandler(async (req, res) => {
        const data = await service.save(getScopedCompanyId(req), req.auth.userId, req.body);
        res.json(data);
    })
];
storeRouter.put("/", ...saveStack);
/** Legacy Node backend used POST on `/api/sync`. */
storeRouter.post("/", ...saveStack);
