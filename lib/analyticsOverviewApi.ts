import { apiRequest, getSelectedCompanyId } from "@/lib/api";

/** Mirrors `GET /api/analytics/overview` — keep fields optional for forward compatibility. */
export type AnalyticsOverviewJson = Record<string, unknown>;

export async function fetchAnalyticsOverview(params: {
  from: string;
  to: string;
  facility?: string;
  department?: string;
}): Promise<AnalyticsOverviewJson> {
  const q = new URLSearchParams({ from: params.from, to: params.to });
  if (params.facility?.trim()) q.set("facility", params.facility.trim());
  if (params.department?.trim()) q.set("department", params.department.trim());
  return apiRequest<AnalyticsOverviewJson>(`/api/analytics/overview?${q.toString()}`, {
    companyId: getSelectedCompanyId().trim() || undefined,
  });
}
