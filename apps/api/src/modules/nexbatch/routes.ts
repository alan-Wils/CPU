import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { requirePlatformRoles } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import type { NexBatchInviteUiTier } from "../../lib/nexbatchRoles.js";
import { NexBatchStaffService } from "../../services/nexbatchStaffService.js";
import { inviteNexBatchStaffSchema, updateNexBatchStaffSchema } from "../../validation/schemas.js";

export const nexbatchRouter = Router();
const nexbatchStaffService = new NexBatchStaffService();

nexbatchRouter.get(
    "/staff",
    requirePlatformRoles(["nexbatch_admin", "owner"]),
    asyncHandler(async (req, res) => {
        const out = await nexbatchStaffService.listStaff({
            actorUserId: req.auth.userId,
            actorPlatformRole: req.auth.platformRole ?? null,
        });
        res.json(out);
    }),
);

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

nexbatchRouter.patch(
    "/staff/:userId",
    requirePlatformRoles(["nexbatch_admin", "owner"]),
    validate({ body: updateNexBatchStaffSchema }),
    asyncHandler(async (req, res) => {
        const body = req.body as { tier?: NexBatchInviteUiTier; active?: boolean };
        const out = await nexbatchStaffService.updateStaff({
            actorUserId: req.auth.userId,
            actorPlatformRole: req.auth.platformRole ?? null,
            userId: String(req.params.userId || ""),
            tier: body.tier,
            active: body.active,
        });
        res.json(out);
    }),
);
