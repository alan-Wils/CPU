/**
 * Cached, deduplicated reads for `/api/config/*` slices.
 * Heavy `GET /api/config/full` should only run from Company Config (admin).
 */

import { apiRequest, getSelectedCompanyId } from "./api";

export type ConfigVersionResponse = {
  companyId: string;
  checksum: string;
  updatedAt: string | null;
  keyCount: number;
};

/** Sliced GET paths supported by the cache (exclude `/full` from version short-circuit when skipVersionCheck). */
export type CachedCompanyConfigPath =
  | "/api/config/basic"
  | "/api/config/cultivation"
  | "/api/config/extraction"
  | "/api/config/packaging"
  | "/api/config/edibles"
  | "/api/config/rewards"
  | "/api/config/integrations"
  | "/api/config/permissions"
  | "/api/config/full";

const inflight = new Map<string, Promise<unknown>>();
const bodyCache = new Map<string, { body: unknown; checksum: string }>();
const versionInflight = new Map<string, Promise<ConfigVersionResponse>>();

function cacheKey(companyId: string, path: string): string {
  return `${companyId.trim() || "_"}::${path}`;
}

/** Drop all in-memory config slices (call after logout or company switch). */
export function clearCompanyConfigClientCache(): void {
  inflight.clear();
  bodyCache.clear();
  versionInflight.clear();
}

/** After any successful config write, clear cache so the next read refetches. */
export function invalidateCompanyConfigClientCache(): void {
  clearCompanyConfigClientCache();
}

export async function fetchConfigVersion(companyId?: string): Promise<ConfigVersionResponse> {
  const cid = (companyId ?? getSelectedCompanyId()).trim();
  const vk = cacheKey(cid, "__version__");
  const pending = versionInflight.get(vk);
  if (pending)
    return pending;
  const p = apiRequest<ConfigVersionResponse>("/api/config/version", { companyId: cid || undefined });
  versionInflight.set(vk, p);
  void p.finally(() => {
    versionInflight.delete(vk);
  });
  return p;
}

/**
 * Returns cached JSON immediately when checksum matches; dedupes concurrent fetches per path+tenant.
 * When the tab is hidden, returns cached body without hitting the network if possible.
 */
export async function fetchCachedCompanyConfig<T>(
  path: CachedCompanyConfigPath,
  options?: {
    companyId?: string;
    auth?: boolean;
    /** Skip memory + version checks (e.g. after explicit invalidation). */
    skipCache?: boolean;
    /** When true, never consults `/api/config/version` (use for `/full` or forced reloads). */
    skipVersionCheck?: boolean;
  },
): Promise<T> {
  const cid = (options?.companyId ?? getSelectedCompanyId()).trim();
  const k = cacheKey(cid, path);

  if (!options?.skipCache) {
    const hit = bodyCache.get(k);
    if (hit?.body) {
      const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
      if (hidden)
        return hit.body as T;
      if (!options?.skipVersionCheck) {
        try {
          const ver = await fetchConfigVersion(cid);
          if (ver.checksum === hit.checksum)
            return hit.body as T;
        }
        catch {
          /* refetch */
        }
      }
      else {
        return hit.body as T;
      }
    }
  }

  const existing = inflight.get(k) as Promise<T> | undefined;
  if (existing)
    return existing;

  const run = (async (): Promise<T> => {
    if (
      !options?.skipCache
      && !options?.skipVersionCheck
      && typeof document !== "undefined"
      && document.visibilityState === "visible"
    ) {
      try {
        const ver = await fetchConfigVersion(cid);
        const hit = bodyCache.get(k);
        if (hit && ver.checksum === hit.checksum)
          return hit.body as T;
      }
      catch {
        /* fetch body */
      }
    }

    const body = await apiRequest<T>(path, {
      companyId: cid || undefined,
      auth: options?.auth,
    });
    let checksum = "";
    try {
      const ver = await fetchConfigVersion(cid);
      checksum = ver.checksum;
    }
    catch {
      checksum = bodyCache.get(k)?.checksum ?? "";
    }
    bodyCache.set(k, { body, checksum });
    return body;
  })();

  inflight.set(k, run);
  try {
    return await run;
  }
  finally {
    inflight.delete(k);
  }
}
