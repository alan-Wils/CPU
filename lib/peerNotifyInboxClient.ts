import type { PeerNotificationItemDto } from "@/lib/api";

const INBOX_CACHE_MS = 5 * 60_000;

let cachedItems: PeerNotificationItemDto[] | null = null;
let cachedAt = 0;
let inflight: Promise<PeerNotificationItemDto[]> | null = null;

let fetchCount = 0;
let cacheHitCount = 0;
let inflightJoinCount = 0;

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

export function getPeerNotifyInboxClientStats(): {
  fetchCount: number;
  cacheHitCount: number;
  inflightJoinCount: number;
  lastFetchAgeMs: number | null;
} {
  return {
    fetchCount,
    cacheHitCount,
    inflightJoinCount,
    lastFetchAgeMs: cachedAt > 0 ? Date.now() - cachedAt : null,
  };
}

function logInboxClientDebug(
  event: string,
  extra?: Record<string, unknown>,
): void {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "production") return;
  if (typeof console === "undefined" || !console.debug) return;
  console.debug("[peerNotifyInbox]", event, {
    fetchCount,
    cacheHitCount,
    inflightJoinCount,
    lastFetchAgeMs: cachedAt > 0 ? Date.now() - cachedAt : null,
    ...extra,
  });
}

/**
 * Dedupes concurrent GET /api/notifications/inbox and reuses a short TTL cache.
 */
export async function fetchPeerNotifyInboxDeduped(
  loader: () => Promise<{ items: PeerNotificationItemDto[]; updatedAt?: string }>,
  opts?: { force?: boolean; caller?: string },
): Promise<{ items: PeerNotificationItemDto[]; updatedAt?: string }> {
  const force = Boolean(opts?.force);
  const caller = String(opts?.caller ?? "unknown");
  const now = Date.now();
  const lastFetchAgeMs = cachedAt > 0 ? now - cachedAt : null;

  if (!force && cachedItems && now - cachedAt < INBOX_CACHE_MS) {
    cacheHitCount += 1;
    logInboxClientDebug("cache_hit", { caller, force, cacheHit: true, inflightJoined: false, lastFetchAgeMs });
    return { items: cachedItems, updatedAt: new Date(cachedAt).toISOString() };
  }
  if (!force && inflight) {
    inflightJoinCount += 1;
    logInboxClientDebug("inflight_join", { caller, force, cacheHit: false, inflightJoined: true, lastFetchAgeMs });
    const items = await inflight;
    return { items, updatedAt: new Date(cachedAt).toISOString() };
  }
  fetchCount += 1;
  logInboxClientDebug("network_fetch", { caller, force, cacheHit: false, inflightJoined: false, lastFetchAgeMs });
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
