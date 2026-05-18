import { prisma } from "../config/prisma.js";

export type PeerInboxItemRow = {
  id: string;
  kind: "task" | "order" | "climate";
  message: string;
  at: string;
  read: boolean;
};

const MAX_ITEMS = 60;

function coerceItems(raw: unknown): PeerInboxItemRow[] {
  if (!Array.isArray(raw)) return [];
  const out: PeerInboxItemRow[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const kind =
      o.kind === "task" || o.kind === "order" || o.kind === "climate" ? o.kind : null;
    const message = typeof o.message === "string" ? o.message : "";
    const at = typeof o.at === "string" ? o.at : "";
    const read = o.read === true;
    if (!id || !kind || !message.trim() || !at.trim())
      continue;
    out.push({ id, kind, message: message.trim(), at, read });
  }
  return out;
}

async function membershipIdForUserCompany(userId: string, companyId: string): Promise<string | null> {
  const m = await prisma.companyMembership.findFirst({
    where: { userId: String(userId || "").trim(), companyId: String(companyId || "").trim() },
    select: { id: true },
  });
  return m?.id ?? null;
}

export async function peerNotifyGetUnreadCount(input: {
  userId: string;
  companyId: string;
}): Promise<{ unreadCount: number; updatedAt: string | null }> {
  const membershipId = await membershipIdForUserCompany(input.userId, input.companyId);
  if (!membershipId) return { unreadCount: 0, updatedAt: null };

  const row = await prisma.peerNotificationInbox.findUnique({
    where: { membershipId },
    select: { items: true, updatedAt: true },
  });
  if (!row) return { unreadCount: 0, updatedAt: null };

  const items = coerceItems(row.items);
  return {
    unreadCount: items.filter((x) => !x.read).length,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function peerNotifyGetInbox(input: {
  userId: string;
  companyId: string;
}): Promise<{ items: PeerInboxItemRow[]; updatedAt: string | null }> {
  const membershipId = await membershipIdForUserCompany(input.userId, input.companyId);
  if (!membershipId) return { items: [], updatedAt: null };

  const row = await prisma.peerNotificationInbox.findUnique({
    where: { membershipId },
    select: { items: true, updatedAt: true },
  });
  if (!row) return { items: [], updatedAt: null };

  return {
    items: coerceItems(row.items),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function peerNotifyPushItem(input: {
  userId: string;
  companyId: string;
  item: PeerInboxItemRow;
}): Promise<{ items: PeerInboxItemRow[] }> {
  const membershipId = await membershipIdForUserCompany(input.userId, input.companyId);
  if (!membershipId) return { items: [] };

  const item = input.item;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.peerNotificationInbox.findUnique({
      where: { membershipId },
      select: { items: true },
    });
    const prev = coerceItems(existing?.items);
    if (prev.some((x) => x.id === item.id)) {
      return { items: prev };
    }
    const next = [item, ...prev].slice(0, MAX_ITEMS);
    await tx.peerNotificationInbox.upsert({
      where: { membershipId },
      create: {
        membershipId,
        items: next,
      },
      update: {
        items: next,
      },
    });
    return { items: next };
  });
}

export async function peerNotifyReplaceInbox(input: {
  userId: string;
  companyId: string;
  items: PeerInboxItemRow[];
}): Promise<{ items: PeerInboxItemRow[] }> {
  const membershipId = await membershipIdForUserCompany(input.userId, input.companyId);
  if (!membershipId) return { items: [] };

  const next = input.items.slice(0, MAX_ITEMS);
  await prisma.peerNotificationInbox.upsert({
    where: { membershipId },
    create: {
      membershipId,
      items: next,
    },
    update: {
      items: next,
    },
  });
  return { items: next };
}
