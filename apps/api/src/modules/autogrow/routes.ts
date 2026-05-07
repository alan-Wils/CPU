import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { requireRole } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { AutogrowReadingsService } from "../../services/autogrowReadingsService.js";

const autogrowReadRoles = [
  "OWNER",
  "ADMIN",
  "OPERATIONS_MANAGER",
  "CULTIVATION_SPECIALIST",
];

const compIndexParam = z.object({
  compIndex: z.coerce.number().int().min(0).max(32),
});
const historyQuery = z.object({
  from: z.coerce.number().int().positive(),
  to: z.coerce.number().int().positive(),
});

export const autogrowRouter = Router();
const autogrowReadingsService = new AutogrowReadingsService();

autogrowRouter.get(
  "/snapshot",
  requireRole(autogrowReadRoles),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const result = await autogrowReadingsService.getSnapshot(companyId);
    if (result.ok === false) {
      res.status(result.status).json({ message: result.message });
      return;
    }
    res.status(200).json(result);
  }),
);

autogrowRouter.get(
  "/comps/:compIndex",
  requireRole(autogrowReadRoles),
  validate({ params: compIndexParam }),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const compIndex = Number((req.params as { compIndex: string }).compIndex);
    const result = await autogrowReadingsService.getCompReadings(companyId, compIndex);
    if (result.ok === false) {
      res.status(result.status).json({ message: result.message });
      return;
    }
    res.status(200).json(result);
  }),
);

autogrowRouter.get(
  "/comps/:compIndex/history",
  requireRole(autogrowReadRoles),
  validate({ params: compIndexParam, query: historyQuery }),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const compIndex = Number((req.params as { compIndex: string }).compIndex);
    const q = req.query as { from: number; to: number };
    const result = await autogrowReadingsService.getCompHistory(companyId, compIndex, Number(q.from), Number(q.to));
    if (result.ok === false) {
      res.status(result.status).json({ message: result.message });
      return;
    }
    res.status(200).json(result);
  }),
);
