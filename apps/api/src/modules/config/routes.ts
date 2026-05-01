import { Router } from "express";
import { z } from "zod";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { configUpsertSchema } from "../../validation/schemas.js";
import { ConfigService } from "../../services/configService.js";
import { requireRole } from "../../middleware/rbac.js";
export const configRouter = Router();
const configService = new ConfigService();
configRouter.get("/", asyncHandler(async (req, res) => {
    const rows = await configService.list(req.auth.companyId);
    const merged = rows.reduce((acc, row) => {
        acc[row.key] = row.value;
        return acc;
    }, {});
    res.json({ ...merged, rows });
}));
configRouter.put("/", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER"]), validate({ body: z.record(z.string(), z.unknown()) }), asyncHandler(async (req, res) => {
    const payload = req.body;
    for (const [key, value] of Object.entries(payload)) {
        await configService.upsert({
            companyId: req.auth.companyId,
            actorUserId: req.auth.userId,
            key,
            value: value
        });
    }
    res.json(payload);
}));
configRouter.post("/", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER"]), validate({ body: configUpsertSchema }), asyncHandler(async (req, res) => {
    const payload = req.body;
    const row = await configService.upsert({
        companyId: req.auth.companyId,
        actorUserId: req.auth.userId,
        key: payload.key,
        value: payload.value
    });
    res.status(201).json(row);
}));
