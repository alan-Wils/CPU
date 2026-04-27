import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { ActivityService } from "../../services/activityService.js";

export const activityRouter = Router();
const service = new ActivityService();

activityRouter.get(
  "/all",
  asyncHandler(async (req, res) => {
    const rows = await service.listMerged(req.auth!.companyId);
    res.json(rows);
  })
);

activityRouter.get(
  "/version",
  asyncHandler(async (req, res) => {
    const version = await service.getVersion(req.auth!.companyId);
    res.json(version);
  })
);
