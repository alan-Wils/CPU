import { apiRequest, getSelectedCompanyId } from "@/lib/api";

export type LiveOperationsCardJson = {
  id: string;
  title: string;
  summary: string;
  href: string;
  items: Record<string, unknown>[];
};

export type AnalyticsLiveOperationsJson = {
  generatedAt: string;
  cards: LiveOperationsCardJson[];
};

export async function fetchAnalyticsLiveOperations(): Promise<AnalyticsLiveOperationsJson> {
  return apiRequest<AnalyticsLiveOperationsJson>("/api/analytics/live-operations", {
    companyId: getSelectedCompanyId().trim() || undefined,
  });
}
