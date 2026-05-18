import type { PeerNotificationItemDto } from "@/lib/api";

const INBOX_CACHE_MS = 3 * 60_000;

let cachedItems: PeerNotificationItemDto[] | null = null;
let cachedAt = 0;
let inflight: Promise<PeerNotificationItemDto[]> | null = null;

export function clearPeerNotifyInboxClientCache(): void {
  cachedItems = null;
  cachedAt = 0;
  inflight = null;
}

export function peekPeerNotifyInboxCache(): PeerNotificationItemDto[] | null {
  if (!cachedItems) return null;
  if (Date.now() - cachedAt > INBOX_CACHE_MS) return null;
  return cachedItems;
}

/**
 * Dedupes concurrent GET /api/notifications/inbox and reuses a short TTL cache.
 */
export async function fetchPeerNotifyInboxDeduped(
  loader: () => Promise<{ items: PeerNotificationItemDto[]; updatedAt?: string }>,
  opts?: { force?: boolean },
): Promise<{ items: PeerNotificationItemDto[]; updatedAt?: string }> {
  const force = Boolean(opts?.force);
  const now = Date.now();
  if (!force && cachedItems && now - cachedAt < INBOX_CACHE_MS) {
    return { items: cachedItems, updatedAt: new Date(cachedAt).toISOString() };
  }
  if (!force && inflight) {
    const items = await inflight;
    return { items, updatedAt: new Date(cachedAt).toISOString() };
  }
  inflight = loader()
    .then((out) => {
      cachedItems = Array.isArray(out.items) ? out.items : [];
      cachedAt = Date.now();
      return cachedItems;
    })
    .finally(() => {
      inflight = null;
    });
  const items = await inflight;
  return { items, updatedAt: new Date(cachedAt).toISOString() };
}
