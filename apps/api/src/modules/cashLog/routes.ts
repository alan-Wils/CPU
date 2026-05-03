import { Router } from "express";
import { z } from "zod";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { requireRole } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { cashLogCreateSchema } from "../../validation/schemas.js";
import { CashLogService } from "../../services/cashLogService.js";
import { AppError } from "../../errors/AppError.js";

const adminRoles = ["OWNER", "ADMIN"];
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const listQuerySchema = z.object({
    take: z.coerce.number().int().positive().max(500).optional(),
    from: isoDate.optional(),
    to: isoDate.optional()
});
const exportQuerySchema = z.object({
    from: isoDate,
    to: isoDate
});

export const cashLogRouter = Router();
const service = new CashLogService();

cashLogRouter.get("/export", requireRole([...adminRoles]), validate({ query: exportQuerySchema }), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    if (!companyId) {
        throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
    }
    const from = String(req.query.from);
    const to = String(req.query.to);
    const rows = await service.listForExport(companyId, { from, to });
    const csv = service.rowsToCsv(rows);
    const safeFrom = from.replace(/[^\d-]/g, "");
    const safeTo = to.replace(/[^\d-]/g, "");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="cash-log-${safeFrom}_${safeTo}.csv"`);
    res.send(csv);
}));

cashLogRouter.get("/", requireRole([...adminRoles]), validate({ query: listQuerySchema }), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    if (!companyId) {
        throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
    }
    const take = Number(req.query?.take || 100);
    const from = typeof req.query?.from === "string" ? req.query.from : undefined;
    const to = typeof req.query?.to === "string" ? req.query.to : undefined;
    const rows = await service.list(companyId, take, { from, to });
    res.json({ rows });
}));

cashLogRouter.post("/", requireRole([...adminRoles]), validate({ body: cashLogCreateSchema }), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    if (!companyId) {
        throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
    }
    const saved = await service.create({
        companyId,
        createdByUserId: req.auth.userId,
        direction: req.body.direction,
        amount: req.body.amount,
        memo: req.body.memo,
        entryDate: req.body.entryDate
    });
    res.status(201).json(saved);
}));
