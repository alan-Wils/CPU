import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { requirePlatformRoles } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import type { NexBatchInviteUiTier } from "../../lib/nexbatchRoles.js";
import { NexBatchStaffService } from "../../services/nexbatchStaffService.js";
import { inviteNexBatchStaffSchema } from "../../validation/schemas.js";

export const nexbatchRouter = Router();
const nexbatchStaffService = new NexBatchStaffService();

nexbatchRouter.post(
    "/staff/invite",
    requirePlatformRoles(["nexbatch_admin", "owner"]),
    validate({ body: inviteNexBatchStaffSchema }),
    asyncHandler(async (req, res) => {
        const body = req.body as { email: string; tier: NexBatchInviteUiTier };
        const out = await nexbatchStaffService.inviteStaff({
            actorUserId: req.auth.userId,
            actorPlatformRole: req.auth.platformRole ?? null,
            email: body.email,
            tier: body.tier,
        });
        res.status(201).json(out);
    }),
);
