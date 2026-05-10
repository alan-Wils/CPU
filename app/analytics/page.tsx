"use client";

import { useCallback, useEffect, useState } from "react";
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

function defaultDateRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 6);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

export default function AnalyticsPage() {
  const [{ from, to }, setRange] = useState(defaultDateRange);
  const [facility, setFacility] = useState("");
  const [department, setDepartment] = useState("all");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [data, setData] = useState<AnalyticsOverviewJson | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sectionPrefs, setSectionPrefs] = useState(loadAnalyticsDashboardPrefs);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const out = await fetchAnalyticsOverview({
        from,
        to,
        facility: facility.trim() || undefined,
        department: department === "all" ? undefined : department,
      });
      setData(out);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [from, to, facility, department]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => {
      void load();
    }, 60_000);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

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
          autoRefresh={autoRefresh}
          onAutoRefreshChange={setAutoRefresh}
          onManualRefresh={() => void load()}
          sectionPrefs={sectionPrefs}
          onSectionPrefsChange={onSectionPrefsChange}
        />
        {sectionPrefs.strain && services?.production ? (
          <div style={{ marginTop: 28 }}>
            <CultivationStrainMetricsCharts from={from} to={to} />
          </div>
        ) : null}
      </main>
    </PageAccessGate>
  );
}
