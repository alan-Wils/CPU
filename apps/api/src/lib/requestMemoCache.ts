/**
 * Short-lived in-memory cache + in-flight dedupe for expensive read endpoints.
 */

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export type MemoizedReadMeta = {
  cacheHit: boolean;
  inflightJoined: boolean;
};

export async function memoizedRead<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const { value } = await memoizedReadWithMeta(key, ttlMs, loader);
  return value;
}

export async function memoizedReadWithMeta<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<{ value: T; cacheHit: boolean; inflightJoined: boolean }> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    return { value: hit.value as T, cacheHit: true, inflightJoined: false };
  }

  const pending = inflight.get(key);
  if (pending) {
    return { value: (await pending) as T, cacheHit: false, inflightJoined: true };
  }

  const p = loader()
    .then((value) => {
      cache.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, p);
  return { value: (await p) as T, cacheHit: false, inflightJoined: false };
}

export function invalidateMemoPrefix(prefix: string): void {
  for (const k of [...cache.keys()]) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}
