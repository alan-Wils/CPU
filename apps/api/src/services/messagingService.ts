import type { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { isOwnerOrAdminRole } from "../lib/appPermissions.js";

export type MessagingCompanySummary = {
    id: string;
    name: string;
    slug: string;
    initials: string;
    /** Sales > Inventory print logo URL (when configured) — same source used for marketplace cards. */
    logoUrl: string | null;
};

export type MessagingMessageDto = {
    id: string;
    conversationId: string;
    senderCompanyId: string;
    senderUserId: string;
    senderUserEmail: string;
    body: string;
    createdAt: string;
    /** True when the current viewing company sent the message (cheap UI hint). */
    mine: boolean;
};

export type MessagingConversationDto = {
    id: string;
    title: string | null;
    createdAt: string;
    lastMessageAt: string;
    /** Other-side participants (excludes the viewing company), in stable name order. */
    participants: MessagingCompanySummary[];
    lastMessage: MessagingMessageDto | null;
    unreadCount: number;
    lastReadAt: string | null;
};

function initialsFromName(name: string): string {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    const first = parts[0]?.[0] || "";
    const second = parts.length > 1 ? parts[parts.length - 1][0] || "" : "";
    return (first + second).toUpperCase() || "?";
}

/**
 * Sales > inventoryPrintLogoUrl per company id (mirrors `marketplaceProductService` lookup so chat heads, marketplace
 * chips, and product cards all show the same brand mark). Companies without a configured value get `null`.
 */
async function inventoryPrintLogoUrlByCompanyIds(companyIds: string[]): Promise<Map<string, string | null>> {
    const unique = [...new Set(companyIds.map((id) => String(id || "").trim()).filter(Boolean))];
    const map = new Map<string, string | null>();
    for (const id of unique) map.set(id, null);
    if (!unique.length) return map;
    const rows = await prisma.companyConfig.findMany({
        where: { companyId: { in: unique }, key: "sales" },
        select: { companyId: true, valueJson: true },
    });
    for (const row of rows) {
        let url: string | null = null;
        try {
            const v = JSON.parse(String(row.valueJson || "{}")) as { inventoryPrintLogoUrl?: unknown };
            const u = typeof v.inventoryPrintLogoUrl === "string" ? v.inventoryPrintLogoUrl.trim() : "";
            url = u || null;
        } catch {
            url = null;
        }
        map.set(row.companyId, url);
    }
    return map;
}

function summarizeCompany(
    c: { id: string; name: string; slug: string },
    logoUrl: string | null,
): MessagingCompanySummary {
    return {
        id: c.id,
        name: c.name,
        slug: c.slug,
        initials: initialsFromName(c.name),
        logoUrl,
    };
}

export class MessagingService {
    /**
     * List active companies in the NexBatch system that the user can start a conversation with.
     * Excludes the viewing company. Matches `q` against name/slug (case-insensitive).
     */
    async searchContacts(opts: {
        viewerCompanyId: string;
        q: string;
        limit: number;
    }): Promise<MessagingCompanySummary[]> {
        const where: Prisma.CompanyWhereInput = {
            id: { not: opts.viewerCompanyId },
            lifecycleStatus: "active",
        };
        const q = String(opts.q || "").trim();
        if (q) {
            where.OR = [
                { name: { contains: q, mode: "insensitive" } },
                { slug: { contains: q, mode: "insensitive" } },
            ];
        }
        const companies = await prisma.company.findMany({
            where,
            orderBy: [{ name: "asc" }],
            take: Math.max(1, Math.min(opts.limit, 50)),
            select: { id: true, name: true, slug: true },
        });
        const logos = await inventoryPrintLogoUrlByCompanyIds(companies.map((c) => c.id));
        return companies.map((c) => summarizeCompany(c, logos.get(c.id) ?? null));
    }

    /**
     * Idempotent upsert of a 1:1 conversation between two companies. Returns the existing conversation if one already
     * exists with exactly this pair of participants — never creates a duplicate thread.
     */
    async getOrCreateDirectConversation(opts: {
        viewerCompanyId: string;
        otherCompanyId: string;
    }): Promise<{ conversationId: string; created: boolean }> {
        if (opts.viewerCompanyId === opts.otherCompanyId) {
            throw new AppError("Cannot start a conversation with your own company.", 400, "INVALID_CONTACT");
        }
        const other = await prisma.company.findUnique({
            where: { id: opts.otherCompanyId },
            select: { id: true, lifecycleStatus: true },
        });
        if (!other) throw new AppError("Contact not found", 404, "CONTACT_NOT_FOUND");
        if (other.lifecycleStatus !== "active") {
            throw new AppError("That workspace is not active yet.", 400, "CONTACT_INACTIVE");
        }

        // Find an existing 1:1 conversation that includes the viewer; return the first that also includes the other side
        // and has exactly two participants. Cheaper than a complex SQL `intersect`.
        const candidates = await prisma.conversation.findMany({
            where: {
                participants: { some: { companyId: opts.viewerCompanyId } },
            },
            include: { participants: { select: { companyId: true } } },
            orderBy: { lastMessageAt: "desc" },
        });
        const match = candidates.find(
            (c) =>
                c.participants.length === 2 &&
                c.participants.some((p) => p.companyId === opts.otherCompanyId),
        );
        if (match) return { conversationId: match.id, created: false };

        const created = await prisma.conversation.create({
            data: {
                participants: {
                    create: [
                        { companyId: opts.viewerCompanyId },
                        { companyId: opts.otherCompanyId },
                    ],
                },
            },
            select: { id: true },
        });
        return { conversationId: created.id, created: true };
    }

    /**
     * Conversations the viewing company participates in, ordered by most recent activity, with the latest message and
     * unread count vs that company's `lastReadAt` marker.
     */
    async listConversationsForCompany(opts: {
        viewerCompanyId: string;
    }): Promise<MessagingConversationDto[]> {
        const myParts = await prisma.conversationParticipant.findMany({
            where: { companyId: opts.viewerCompanyId },
            select: { conversationId: true, lastReadAt: true },
        });
        if (!myParts.length) return [];

        const convoIds = myParts.map((p) => p.conversationId);
        const convos = await prisma.conversation.findMany({
            where: { id: { in: convoIds } },
            orderBy: { lastMessageAt: "desc" },
            include: {
                participants: {
                    include: {
                        company: { select: { id: true, name: true, slug: true } },
                    },
                },
            },
        });

        // Pull the latest non-deleted message per conversation in one query; build a map.
        const latestRows = await prisma.conversationMessage.findMany({
            where: { conversationId: { in: convoIds }, deletedAt: null },
            orderBy: [{ createdAt: "desc" }],
        });
        const latestByConvo = new Map<string, (typeof latestRows)[number]>();
        for (const m of latestRows) {
            if (!latestByConvo.has(m.conversationId)) latestByConvo.set(m.conversationId, m);
        }

        // Resolve sender user emails for the latest messages.
        const userIds = [...new Set([...latestByConvo.values()].map((m) => m.senderUserId))];
        const userRows = userIds.length
            ? await prisma.user.findMany({
                  where: { id: { in: userIds } },
                  select: { id: true, email: true },
              })
            : [];
        const emailByUser = new Map(userRows.map((u) => [u.id, u.email] as const));

        // Logos for every participant company in one batched lookup.
        const allCompanyIds = new Set<string>();
        for (const c of convos) for (const p of c.participants) allCompanyIds.add(p.companyId);
        const logos = await inventoryPrintLogoUrlByCompanyIds([...allCompanyIds]);

        // Unread counts per conversation: messages newer than `lastReadAt` not authored by the viewing company.
        const myReadByConvo = new Map(myParts.map((p) => [p.conversationId, p.lastReadAt] as const));
        const unreadCounts = await Promise.all(
            convoIds.map(async (cid) => {
                const lastReadAt = myReadByConvo.get(cid) ?? null;
                const where: Prisma.ConversationMessageWhereInput = {
                    conversationId: cid,
                    senderCompanyId: { not: opts.viewerCompanyId },
                    deletedAt: null,
                };
                if (lastReadAt) where.createdAt = { gt: lastReadAt };
                const n = await prisma.conversationMessage.count({ where });
                return [cid, n] as const;
            }),
        );
        const unreadByConvo = new Map(unreadCounts);

        const dto: MessagingConversationDto[] = convos.map((c) => {
            const otherParticipants = c.participants
                .filter((p) => p.companyId !== opts.viewerCompanyId)
                .sort((a, b) => a.company.name.localeCompare(b.company.name))
                .map((p) => summarizeCompany(p.company, logos.get(p.companyId) ?? null));
            const last = latestByConvo.get(c.id);
            const lastMessage: MessagingMessageDto | null = last
                ? {
                      id: last.id,
                      conversationId: last.conversationId,
                      senderCompanyId: last.senderCompanyId,
                      senderUserId: last.senderUserId,
                      senderUserEmail: emailByUser.get(last.senderUserId) ?? "",
                      body: last.body,
                      createdAt: last.createdAt.toISOString(),
                      mine: last.senderCompanyId === opts.viewerCompanyId,
                  }
                : null;
            const lastReadAt = myReadByConvo.get(c.id) ?? null;
            return {
                id: c.id,
                title: c.title,
                createdAt: c.createdAt.toISOString(),
                lastMessageAt: c.lastMessageAt.toISOString(),
                participants: otherParticipants,
                lastMessage,
                unreadCount: unreadByConvo.get(c.id) ?? 0,
                lastReadAt: lastReadAt ? lastReadAt.toISOString() : null,
            };
        });
        return dto;
    }

    /** Confirms the viewing company is a participant before any read/write to a conversation. */
    private async assertParticipant(conversationId: string, viewerCompanyId: string): Promise<void> {
        const part = await prisma.conversationParticipant.findUnique({
            where: { conversationId_companyId: { conversationId, companyId: viewerCompanyId } },
            select: { id: true },
        });
        if (!part) throw new AppError("Conversation not found", 404, "CONVERSATION_NOT_FOUND");
    }

    /**
     * Page messages oldest→newest within a conversation. `before` lets the client load older history; default returns
     * the most recent `limit` messages and the client renders them in chronological order.
     */
    async listMessages(opts: {
        viewerCompanyId: string;
        conversationId: string;
        before?: string;
        limit?: number;
    }): Promise<{ messages: MessagingMessageDto[]; hasMore: boolean }> {
        await this.assertParticipant(opts.conversationId, opts.viewerCompanyId);
        const limit = Math.max(1, Math.min(opts.limit ?? 60, 200));
        const where: Prisma.ConversationMessageWhereInput = {
            conversationId: opts.conversationId,
            deletedAt: null,
        };
        if (opts.before) {
            const cursor = new Date(opts.before);
            if (!Number.isNaN(cursor.getTime())) where.createdAt = { lt: cursor };
        }
        const rows = await prisma.conversationMessage.findMany({
            where,
            orderBy: [{ createdAt: "desc" }],
            take: limit + 1,
        });
        const hasMore = rows.length > limit;
        const trimmed = hasMore ? rows.slice(0, limit) : rows;
        const userIds = [...new Set(trimmed.map((m) => m.senderUserId))];
        const userRows = userIds.length
            ? await prisma.user.findMany({
                  where: { id: { in: userIds } },
                  select: { id: true, email: true },
              })
            : [];
        const emailByUser = new Map(userRows.map((u) => [u.id, u.email] as const));
        const ascending = [...trimmed].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return {
            hasMore,
            messages: ascending.map((m) => ({
                id: m.id,
                conversationId: m.conversationId,
                senderCompanyId: m.senderCompanyId,
                senderUserId: m.senderUserId,
                senderUserEmail: emailByUser.get(m.senderUserId) ?? "",
                body: m.body,
                createdAt: m.createdAt.toISOString(),
                mine: m.senderCompanyId === opts.viewerCompanyId,
            })),
        };
    }

    /** Append a message; bumps `lastMessageAt` so the conversation list reorders. */
    async sendMessage(opts: {
        viewerCompanyId: string;
        viewerUserId: string;
        conversationId: string;
        body: string;
    }): Promise<MessagingMessageDto> {
        await this.assertParticipant(opts.conversationId, opts.viewerCompanyId);
        const body = String(opts.body || "").trim();
        if (!body) throw new AppError("Message cannot be empty.", 400, "EMPTY_MESSAGE");
        const created = await prisma.$transaction(async (tx) => {
            const msg = await tx.conversationMessage.create({
                data: {
                    conversationId: opts.conversationId,
                    senderCompanyId: opts.viewerCompanyId,
                    senderUserId: opts.viewerUserId,
                    body,
                },
            });
            await tx.conversation.update({
                where: { id: opts.conversationId },
                data: { lastMessageAt: msg.createdAt },
            });
            // Sender's own read marker advances automatically — they've "seen" their own message.
            await tx.conversationParticipant.update({
                where: {
                    conversationId_companyId: {
                        conversationId: opts.conversationId,
                        companyId: opts.viewerCompanyId,
                    },
                },
                data: { lastReadAt: msg.createdAt },
            });
            return msg;
        });
        const sender = await prisma.user.findUnique({
            where: { id: created.senderUserId },
            select: { email: true },
        });
        return {
            id: created.id,
            conversationId: created.conversationId,
            senderCompanyId: created.senderCompanyId,
            senderUserId: created.senderUserId,
            senderUserEmail: sender?.email ?? "",
            body: created.body,
            createdAt: created.createdAt.toISOString(),
            mine: true,
        };
    }

    /** Move the viewing company's `lastReadAt` marker forward to "now" (idempotent). */
    async markRead(opts: { viewerCompanyId: string; conversationId: string }): Promise<void> {
        await this.assertParticipant(opts.conversationId, opts.viewerCompanyId);
        await prisma.conversationParticipant.update({
            where: {
                conversationId_companyId: {
                    conversationId: opts.conversationId,
                    companyId: opts.viewerCompanyId,
                },
            },
            data: { lastReadAt: new Date() },
        });
    }

    /** Total unread messages across every conversation for the viewing company (powers the header bell badge). */
    async getUnreadTotal(viewerCompanyId: string): Promise<number> {
        const myParts = await prisma.conversationParticipant.findMany({
            where: { companyId: viewerCompanyId },
            select: { conversationId: true, lastReadAt: true },
        });
        if (!myParts.length) return 0;
        let total = 0;
        for (const p of myParts) {
            const where: Prisma.ConversationMessageWhereInput = {
                conversationId: p.conversationId,
                senderCompanyId: { not: viewerCompanyId },
                deletedAt: null,
            };
            if (p.lastReadAt) where.createdAt = { gt: p.lastReadAt };
            total += await prisma.conversationMessage.count({ where });
        }
        return total;
    }

    /**
     * Soft-delete a message that the viewing company sent. Owners and admins of the sender company can
     * remove their own outgoing messages; the row stays for audit (`deletedAt`, `deletedByUserId`) but is
     * filtered out of every read path so neither side sees it again. Cross-company deletion is rejected
     * (you can only delete from your side of the thread).
     */
    async deleteOwnMessage(opts: {
        viewerCompanyId: string;
        viewerUserId: string;
        viewerRole: string;
        conversationId: string;
        messageId: string;
    }): Promise<{ ok: true }> {
        if (!isOwnerOrAdminRole(String(opts.viewerRole || ""))) {
            throw new AppError(
                "Only company owners or admins can delete messages.",
                403,
                "MESSAGING_DELETE_FORBIDDEN",
            );
        }
        await this.assertParticipant(opts.conversationId, opts.viewerCompanyId);

        const message = await prisma.conversationMessage.findFirst({
            where: { id: opts.messageId, conversationId: opts.conversationId },
            select: { id: true, senderCompanyId: true, deletedAt: true },
        });
        if (!message) throw new AppError("Message not found", 404, "MESSAGE_NOT_FOUND");
        if (message.senderCompanyId !== opts.viewerCompanyId) {
            throw new AppError(
                "You can only delete messages from your own company.",
                403,
                "MESSAGING_DELETE_FOREIGN",
            );
        }
        if (message.deletedAt) {
            // Idempotent — repeated delete from concurrent tabs should not error.
            return { ok: true };
        }

        await prisma.conversationMessage.update({
            where: { id: message.id },
            data: { deletedAt: new Date(), deletedByUserId: opts.viewerUserId },
        });

        // If this was the conversation's most recent message, roll `lastMessageAt` back to the next
        // surviving message so the conversation list ordering reflects reality.
        const next = await prisma.conversationMessage.findFirst({
            where: { conversationId: opts.conversationId, deletedAt: null },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true },
        });
        await prisma.conversation.update({
            where: { id: opts.conversationId },
            data: { lastMessageAt: next?.createdAt ?? new Date(0) },
        });

        return { ok: true };
    }
}
