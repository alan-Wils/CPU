import { Router } from "express";
import type { NexBatchPlatformRole } from "@prisma/client";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { requirePlatformRoles } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { NexBatchStaffService } from "../../services/nexbatchStaffService.js";
import { createNexBatchStaffSchema } from "../../validation/schemas.js";

export const nexbatchRouter = Router();
const nexbatchStaffService = new NexBatchStaffService();

nexbatchRouter.post(
    "/staff",
    requirePlatformRoles(["nexbatch_admin", "owner"]),
    validate({ body: createNexBatchStaffSchema }),
    asyncHandler(async (req, res) => {
        const body = req.body as { email: string; password: string; platformRole: string };
        const out = await nexbatchStaffService.createStaff({
            actorUserId: req.auth.userId,
            actorPlatformRole: req.auth.platformRole ?? null,
            email: body.email,
            password: body.password,
            platformRole: body.platformRole as NexBatchPlatformRole,
        });
        res.status(201).json(out);
    }),
);
