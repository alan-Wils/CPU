import { apiRequest, getSelectedCompanyId } from "@/lib/api";

/** Mirrors `GET /api/analytics/overview` — keep fields optional for forward compatibility. */
export type AnalyticsOverviewJson = Record<string, unknown>;

const inflight = new Map<string, Promise<AnalyticsOverviewJson>>();

export async function fetchAnalyticsOverview(params: {
  from: string;
  to: string;
  facility?: string;
  department?: string;
}): Promise<AnalyticsOverviewJson> {
  const q = new URLSearchParams({ from: params.from, to: params.to });
  if (params.facility?.trim()) q.set("facility", params.facility.trim());
  if (params.department?.trim()) q.set("department", params.department.trim());
  const companyId = getSelectedCompanyId().trim() || "";
  const key = `${companyId}|${q.toString()}`;

  const pending = inflight.get(key);
  if (pending) return pending;

  const p = apiRequest<AnalyticsOverviewJson>(`/api/analytics/overview?${q.toString()}`, {
    companyId: companyId || undefined,
  }).finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, p);
  return p;
}
