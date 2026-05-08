import { Router } from "express";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { z } from "zod";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { checkUploadSchema, configUpsertSchema } from "../../validation/schemas.js";
import { ConfigService } from "../../services/configService.js";
import { CompanyLogoUploadService } from "../../services/companyLogoUploadService.js";
import { requireRole } from "../../middleware/rbac.js";
import { AppError } from "../../errors/AppError.js";
import { requestPublicOrigin } from "../../lib/requestPublicOrigin.js";
export const configRouter = Router();
const configService = new ConfigService();
const companyLogoUploadService = new CompanyLogoUploadService();
configRouter.get("/", asyncHandler(async (req, res) => {
    const rows = await configService.list(getScopedCompanyId(req));
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
            companyId: getScopedCompanyId(req),
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
        companyId: getScopedCompanyId(req),
        actorUserId: req.auth.userId,
        key: payload.key,
        value: payload.value
    });
    res.status(201).json(row);
}));

configRouter.post(
    "/upload-company-logo",
    requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER"]),
    validate({ body: checkUploadSchema }),
    asyncHandler(async (req, res) => {
        const companyId = getScopedCompanyId(req);
        if (!companyId) {
            throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
        }
        const origin = requestPublicOrigin(req);
        const uploaded = await companyLogoUploadService.uploadLogo({
            companyId,
            mimeType: req.body.mimeType,
            dataBase64: req.body.dataBase64,
            origin,
        });
        res.status(201).json(uploaded);
    }),
);
