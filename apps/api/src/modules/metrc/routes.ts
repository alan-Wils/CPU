import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { requireRole } from "../../middleware/rbac.js";
import { MetrcConnectionService } from "../../services/metrcConnectionService.js";

export const metrcRouter = Router();
const metrcConnectionService = new MetrcConnectionService();

/** Safe read-only probe: GET METRC active locations (no writes). */
metrcRouter.get(
  "/test-connection",
  requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER"]),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const result = await metrcConnectionService.runTestConnection({
      companyId,
      actorUserId: req.auth.userId,
    });
    res.status(200).json(result);
  }),
);
