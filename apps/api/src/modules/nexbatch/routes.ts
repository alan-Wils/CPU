import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { requireNexBatchStaffManagers } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import type { NexBatchInviteUiTier } from "../../lib/nexbatchRoles.js";
import { NexBatchStaffService } from "../../services/nexbatchStaffService.js";
import {
    inviteNexBatchStaffSchema,
    nexbatchStaffCompanyAccessSchema,
    updateNexBatchStaffSchema,
} from "../../validation/schemas.js";
import { z } from "zod";

export const nexbatchRouter = Router();
const nexbatchStaffService = new NexBatchStaffService();

const nexbatchUserIdParam = z.object({
    userId: z.string().cuid(),
});

nexbatchRouter.get(
    "/staff",
    requireNexBatchStaffManagers,
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
    requireNexBatchStaffManagers,
    validate({ body: inviteNexBatchStaffSchema }),
    asyncHandler(async (req, res) => {
        const body = req.body as {
            email: string;
            tier: NexBatchInviteUiTier;
            companyIds?: string[];
        };
        const out = await nexbatchStaffService.inviteStaff({
            actorUserId: req.auth.userId,
            actorPlatformRole: req.auth.platformRole ?? null,
            email: body.email,
            tier: body.tier,
            companyIds: body.companyIds,
        });
        res.status(201).json(out);
    }),
);

nexbatchRouter.patch(
    "/staff/:userId",
    requireNexBatchStaffManagers,
    validate({ params: nexbatchUserIdParam, body: updateNexBatchStaffSchema }),
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

nexbatchRouter.post(
    "/staff/:userId/company-access",
    requireNexBatchStaffManagers,
    validate({ params: nexbatchUserIdParam, body: nexbatchStaffCompanyAccessSchema }),
    asyncHandler(async (req, res) => {
        const body = req.body as { add?: string[]; remove?: string[] };
        const out = await nexbatchStaffService.updatePortalStaffCompanyAccess({
            actorUserId: req.auth.userId,
            actorPlatformRole: req.auth.platformRole ?? null,
            targetUserId: String(req.params.userId || ""),
            add: body.add,
            remove: body.remove,
        });
        res.json(out);
    }),
);

nexbatchRouter.delete(
    "/staff/invites/:inviteId",
    requireNexBatchStaffManagers,
    asyncHandler(async (req, res) => {
        const out = await nexbatchStaffService.revokePendingStaffInvite({
            actorUserId: req.auth.userId,
            actorPlatformRole: req.auth.platformRole ?? null,
            inviteId: String(req.params.inviteId || ""),
        });
        res.json(out);
    }),
);
