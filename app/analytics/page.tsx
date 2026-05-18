"use client";

import { useCallback, useEffect, useState } from "react";
import { useVisibilityPolling } from "@/lib/useVisibilityPolling";
import Nav from "@/components/Nav";
import PageAccessGate from "@/components/PageAccessGate";
import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";
import { CultivationStrainMetricsCharts } from "@/app/analytics/CultivationStrainMetricsCharts";
import { fetchAnalyticsOverview, type AnalyticsOverviewJson } from "@/lib/analyticsOverviewApi";
import {
  loadAnalyticsDashboardPrefs,
  saveAnalyticsDashboardPrefs,
  type AnalyticsSectionKey,
} from "@/lib/analyticsDashboardPrefs";
import { defaultAnalyticsDateRange } from "@/lib/analyticsDefaultDateRange";
import { SilentRefreshToast } from "@/components/analytics/SilentRefreshToast";

export default function AnalyticsPage() {
  const [{ from, to }, setRange] = useState(defaultAnalyticsDateRange);
  const [facility, setFacility] = useState("");
  const [department, setDepartment] = useState("all");
  const [data, setData] = useState<AnalyticsOverviewJson | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sectionPrefs, setSectionPrefs] = useState(loadAnalyticsDashboardPrefs);
  const [silentRefreshPulse, setSilentRefreshPulse] = useState(0);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const out = await fetchAnalyticsOverview({
        from,
        to,
        facility: facility.trim() || undefined,
        department: department === "all" ? undefined : department,
      });
      setData(out);
      if (silent) {
        setError(null);
        setSilentRefreshPulse((p) => p + 1);
      }
    } catch (e) {
      if (!silent) {
        setData(null);
        setError(e instanceof Error ? e.message : "Failed to load analytics");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [from, to, facility, department]);

  useEffect(() => {
    void load();
  }, [load]);

  useVisibilityPolling({
    intervalMs: 5 * 60_000,
    refreshOnVisible: true,
    onPoll: () => load({ silent: true }),
  });

  const onSectionPrefsChange = useCallback((next: Record<AnalyticsSectionKey, boolean>) => {
    setSectionPrefs(next);
    saveAnalyticsDashboardPrefs(next);
  }, []);

  const services = data?.services as Record<string, boolean> | undefined;

  const pageStyle = {
    minHeight: "100vh",
    background: "radial-gradient(circle at top, #1e293b 0, #020617 45%, #020617 100%)",
    color: "white",
    padding: 20,
  } as const;

  return (
    <PageAccessGate permission="page.analytics">
      <main style={pageStyle}>
        <Nav />
        <AnalyticsDashboard
          data={data}
          loading={loading}
          error={error}
          from={from}
          to={to}
          onFromToChange={setRange}
          facility={facility}
          onFacilityChange={setFacility}
          department={department}
          onDepartmentChange={setDepartment}
          onManualRefresh={() => void load()}
          sectionPrefs={sectionPrefs}
          onSectionPrefsChange={onSectionPrefsChange}
        />
        {sectionPrefs.strain && services?.production ? (
          <div style={{ marginTop: 28 }}>
            <CultivationStrainMetricsCharts from={from} to={to} />
          </div>
        ) : null}
        <SilentRefreshToast pulse={silentRefreshPulse} />
      </main>
    </PageAccessGate>
  );
}
