import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { requirePlatformRoles } from "../../middleware/rbac.js";
import { companyIdParam, portalCompanyServicesPatchSchema } from "../../validation/schemas.js";
import { CompanyServiceSettingsService } from "../../services/companyServiceSettingsService.js";

export const portalRouter = Router();
const settingsService = new CompanyServiceSettingsService();

portalRouter.get(
  "/companies/:companyId/services",
  requirePlatformRoles(["nexbatch_admin", "owner"]),
  validate({ params: companyIdParam }),
  asyncHandler(async (req, res) => {
    const companyId = String(req.params.companyId || "").trim();
    const services = await settingsService.getOrCreate(companyId);
    res.json({ services });
  }),
);

portalRouter.patch(
  "/companies/:companyId/services",
  requirePlatformRoles(["nexbatch_admin", "owner"]),
  validate({ params: companyIdParam, body: portalCompanyServicesPatchSchema }),
  asyncHandler(async (req, res) => {
    const companyId = String(req.params.companyId || "").trim();
    const services = await settingsService.updateForPortal(companyId, req.body);
    res.json({ services });
  }),
);
