import { apiRequest, getSelectedCompanyId } from "@/lib/api";

/** Mirrors `GET /api/analytics/overview` — keep fields optional for forward compatibility. */
export type AnalyticsOverviewJson = Record<string, unknown>;

const CLIENT_CACHE_MS = 3 * 60_000;

type CacheEntry = { at: number; data: AnalyticsOverviewJson };
const responseCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<AnalyticsOverviewJson>>();

function cacheKey(params: {
  from: string;
  to: string;
  facility?: string;
  department?: string;
}): string {
  const companyId = getSelectedCompanyId().trim() || "";
  const facility = String(params.facility ?? "").trim().toLowerCase();
  const department = String(params.department ?? "all").trim().toLowerCase() || "all";
  return `${companyId}|${params.from}|${params.to}|${facility}|${department}`;
}

export function peekAnalyticsOverviewClientCache(params: {
  from: string;
  to: string;
  facility?: string;
  department?: string;
}): AnalyticsOverviewJson | null {
  const key = cacheKey(params);
  const hit = responseCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CLIENT_CACHE_MS) {
    responseCache.delete(key);
    return null;
  }
  return hit.data;
}

/** Fire-and-forget warm fetch after login / layout mount (does not block UI). */
export function warmAnalyticsOverviewCache(params: {
  from: string;
  to: string;
  facility?: string;
  department?: string;
}): void {
  if (peekAnalyticsOverviewClientCache(params)) return;
  void fetchAnalyticsOverview(params).catch(() => {});
}

export async function fetchAnalyticsOverview(
  params: {
    from: string;
    to: string;
    facility?: string;
    department?: string;
  },
  opts?: { refresh?: boolean },
): Promise<AnalyticsOverviewJson> {
  const refresh = Boolean(opts?.refresh);
  const key = cacheKey(params);
  const now = Date.now();

  if (!refresh) {
    const cached = responseCache.get(key);
    if (cached && now - cached.at < CLIENT_CACHE_MS) {
      return cached.data;
    }
  }

  const pending = inflight.get(key);
  if (!refresh && pending) return pending;

  const q = new URLSearchParams({ from: params.from, to: params.to });
  if (params.facility?.trim()) q.set("facility", params.facility.trim());
  if (params.department?.trim() && params.department.trim().toLowerCase() !== "all") {
    q.set("department", params.department.trim());
  }
  const companyId = getSelectedCompanyId().trim() || "";

  const p = apiRequest<AnalyticsOverviewJson>(`/api/analytics/overview?${q.toString()}`, {
    companyId: companyId || undefined,
  })
    .then((data) => {
      responseCache.set(key, { at: Date.now(), data });
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, p);
  return p;
}
