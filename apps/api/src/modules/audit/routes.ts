import { Router } from "express";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AuditService } from "../../services/auditService.js";
import { requireRole } from "../../middleware/rbac.js";
export const auditRouter = Router();
const auditService = new AuditService();
auditRouter.get("/logs", requireRole(["OWNER", "ADMIN"]), asyncHandler(async (req, res) => {
    const logs = await auditService.list(getScopedCompanyId(req));
    res.json({ logs });
}));
