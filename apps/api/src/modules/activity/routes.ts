import { Router } from "express";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { ActivityService } from "../../services/activityService.js";
export const activityRouter = Router();
const service = new ActivityService();
activityRouter.get("/all", asyncHandler(async (req, res) => {
    const rows = await service.listMerged(getScopedCompanyId(req));
    res.json(rows);
}));
activityRouter.get("/version", asyncHandler(async (req, res) => {
    const version = await service.getVersion(getScopedCompanyId(req));
    res.json(version);
}));
