import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { validate } from "../../middleware/validate.js";
import {
    conversationIdParamSchema,
    conversationMessageParamSchema,
    messagingContactsSearchSchema,
    messagingMessagesQuerySchema,
    messagingSendMessageSchema,
    messagingStartConversationSchema,
} from "../../validation/schemas.js";
import { MessagingService } from "../../services/messagingService.js";

export const messagingRouter = Router();
const messagingService = new MessagingService();

messagingRouter.get(
    "/conversations",
    asyncHandler(async (req, res) => {
        const viewerCompanyId = getScopedCompanyId(req);
        const conversations = await messagingService.listConversationsForCompany({ viewerCompanyId });
        res.json({ conversations });
    }),
);

messagingRouter.get(
    "/unread",
    asyncHandler(async (req, res) => {
        const viewerCompanyId = getScopedCompanyId(req);
        const unread = await messagingService.getUnreadTotal(viewerCompanyId);
        res.json({ unread });
    }),
);

messagingRouter.post(
    "/conversations",
    validate({ body: messagingStartConversationSchema }),
    asyncHandler(async (req, res) => {
        const viewerCompanyId = getScopedCompanyId(req);
        const body = req.body as z.infer<typeof messagingStartConversationSchema>;
        const out = await messagingService.getOrCreateDirectConversation({
            viewerCompanyId,
            otherCompanyId: body.companyId,
        });
        res.status(out.created ? 201 : 200).json(out);
    }),
);

messagingRouter.get(
    "/conversations/:conversationId/messages",
    validate({ params: conversationIdParamSchema, query: messagingMessagesQuerySchema }),
    asyncHandler(async (req, res) => {
        const viewerCompanyId = getScopedCompanyId(req);
        const { conversationId } = req.params as z.infer<typeof conversationIdParamSchema>;
        const q = req.query as z.infer<typeof messagingMessagesQuerySchema>;
        const out = await messagingService.listMessages({
            viewerCompanyId,
            conversationId,
            before: q.before,
            limit: q.limit,
        });
        res.json(out);
    }),
);

messagingRouter.post(
    "/conversations/:conversationId/messages",
    validate({ params: conversationIdParamSchema, body: messagingSendMessageSchema }),
    asyncHandler(async (req, res) => {
        const viewerCompanyId = getScopedCompanyId(req);
        const viewerUserId = req.auth!.userId;
        const { conversationId } = req.params as z.infer<typeof conversationIdParamSchema>;
        const body = req.body as z.infer<typeof messagingSendMessageSchema>;
        const message = await messagingService.sendMessage({
            viewerCompanyId,
            viewerUserId,
            conversationId,
            body: body.body,
        });
        res.status(201).json({ message });
    }),
);

/**
 * Soft-delete a message that the viewer's company sent. Restricted to OWNER/ADMIN role on the
 * sender side; both sender and recipient stop seeing the message after this returns 200.
 */
messagingRouter.delete(
    "/conversations/:conversationId/messages/:messageId",
    validate({ params: conversationMessageParamSchema }),
    asyncHandler(async (req, res) => {
        const viewerCompanyId = getScopedCompanyId(req);
        const { conversationId, messageId } = req.params as z.infer<typeof conversationMessageParamSchema>;
        const out = await messagingService.deleteOwnMessage({
            viewerCompanyId,
            viewerUserId: req.auth!.userId,
            viewerRole: String(req.auth?.role || ""),
            conversationId,
            messageId,
        });
        res.json(out);
    }),
);

messagingRouter.post(
    "/conversations/:conversationId/read",
    validate({ params: conversationIdParamSchema }),
    asyncHandler(async (req, res) => {
        const viewerCompanyId = getScopedCompanyId(req);
        const { conversationId } = req.params as z.infer<typeof conversationIdParamSchema>;
        await messagingService.markRead({ viewerCompanyId, conversationId });
        res.json({ ok: true });
    }),
);

messagingRouter.get(
    "/contacts/search",
    validate({ query: messagingContactsSearchSchema }),
    asyncHandler(async (req, res) => {
        const viewerCompanyId = getScopedCompanyId(req);
        const q = req.query as z.infer<typeof messagingContactsSearchSchema>;
        const contacts = await messagingService.searchContacts({
            viewerCompanyId,
            q: q.q ?? "",
            limit: q.limit ?? 25,
        });
        res.json({ contacts });
    }),
);
