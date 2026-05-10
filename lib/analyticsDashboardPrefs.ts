export const ANALYTICS_DASHBOARD_PREFS_KEY = "cpu.analytics.dashboard.sections.v1";

export type AnalyticsSectionKey =
  | "kpis"
  | "production"
  | "sales"
  | "buyer"
  | "labor"
  | "executive"
  | "strain";

const defaults: Record<AnalyticsSectionKey, boolean> = {
  kpis: true,
  production: true,
  sales: true,
  buyer: true,
  labor: true,
  executive: true,
  strain: true,
};

export function loadAnalyticsDashboardPrefs(): Record<AnalyticsSectionKey, boolean> {
  if (typeof window === "undefined") return { ...defaults };
  try {
    const raw = window.localStorage.getItem(ANALYTICS_DASHBOARD_PREFS_KEY);
    if (!raw) return { ...defaults };
    const o = JSON.parse(raw) as Partial<Record<AnalyticsSectionKey, boolean>>;
    return { ...defaults, ...o };
  } catch {
    return { ...defaults };
  }
}

export function saveAnalyticsDashboardPrefs(next: Record<AnalyticsSectionKey, boolean>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ANALYTICS_DASHBOARD_PREFS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}
