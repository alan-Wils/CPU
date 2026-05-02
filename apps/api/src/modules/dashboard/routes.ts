import { Router } from "express";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { DashboardService } from "../../services/dashboardService.js";
export const dashboardRouter = Router();
const dashboardService = new DashboardService();
dashboardRouter.get("/overview", asyncHandler(async (req, res) => {
    const data = await dashboardService.getOverview(getScopedCompanyId(req));
    res.json(data);
}));
