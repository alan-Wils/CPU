import { Router } from "express";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import {
    peerNotifyInboxPushSchema,
    peerNotifyInboxReplaceSchema,
} from "../../validation/schemas.js";
import {
    peerNotifyGetInbox,
    peerNotifyPushItem,
    peerNotifyReplaceInbox,
    type PeerInboxItemRow,
} from "../../services/peerNotificationInboxService.js";

export const notificationsRouter = Router();

notificationsRouter.get("/inbox", asyncHandler(async (req, res) => {
    const auth = req.auth!;
    const companyId = getScopedCompanyId(req);
    const out = await peerNotifyGetInbox({
        userId: auth.userId,
        companyId,
    });
    res.json({
        items: out.items,
        updatedAt: out.updatedAt,
    });
}));

notificationsRouter.post(
    "/inbox/push",
    validate({ body: peerNotifyInboxPushSchema }),
    asyncHandler(async (req, res) => {
        const auth = req.auth!;
        const companyId = getScopedCompanyId(req);
        const item = req.body.item as PeerInboxItemRow;
        const out = await peerNotifyPushItem({
            userId: auth.userId,
            companyId,
            item,
        });
        res.json({ items: out.items });
    }),
);

notificationsRouter.put(
    "/inbox",
    validate({ body: peerNotifyInboxReplaceSchema }),
    asyncHandler(async (req, res) => {
        const auth = req.auth!;
        const companyId = getScopedCompanyId(req);
        const items = req.body.items as PeerInboxItemRow[];
        const out = await peerNotifyReplaceInbox({
            userId: auth.userId,
            companyId,
            items,
        });
        res.json({ items: out.items });
    }),
);
