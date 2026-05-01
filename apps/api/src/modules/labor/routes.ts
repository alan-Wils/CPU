import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { laborEntryCreateSchema } from "../../validation/schemas.js";
import { LaborService } from "../../services/laborService.js";
import { requireRole } from "../../middleware/rbac.js";
export const laborRouter = Router();
const laborService = new LaborService();
laborRouter.post("/entries", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER", "CULTIVATION_SPECIALIST", "EXTRACTION_SPECIALIST", "PACKAGING_SPECIALIST"]), validate({ body: laborEntryCreateSchema }), asyncHandler(async (req, res) => {
    const payload = req.body;
    const labor = await laborService.createEntry({
        companyId: req.auth.companyId,
        actorUserId: req.auth.userId,
        ...payload
    });
    res.status(201).json(labor);
}));
laborRouter.get("/cpu", asyncHandler(async (req, res) => {
    const period = typeof req.query.period === "string" ? req.query.period : undefined;
    const rows = await laborService.listCpu(req.auth.companyId, period);
    res.json({ rows });
}));
