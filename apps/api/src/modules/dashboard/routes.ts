import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { DashboardService } from "../../services/dashboardService.js";

export const dashboardRouter = Router();
const dashboardService = new DashboardService();

dashboardRouter.get(
  "/overview",
  asyncHandler(async (req, res) => {
    const data = await dashboardService.getOverview(req.auth!.companyId);
    res.json(data);
  })
);
