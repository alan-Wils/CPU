"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Nav from "@/components/Nav";
import PageAccessGate from "@/components/PageAccessGate";
import { apiRequest } from "@/lib/api";
import {
  fetchCultivationStrainMetrics,
  type CultivationStrainMetricPoint,
} from "@/lib/analyticsApi";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ConfigStrain = {
  id?: string;
  name?: string;
  strain?: string;
  acronym?: string;
};

function getStrainLabel(s: ConfigStrain) {
  const name = String(s?.name || s?.strain || "").trim();
  const ac = String(s?.acronym || "").trim().toUpperCase();
  return name ? `${name} (${ac || "?"})` : ac || "Strain";
}

function getStrainAcronym(s: ConfigStrain) {
  return String(s?.acronym || "").trim().toUpperCase();
}

function defaultDateRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 90);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

const STRAIN_COLORS = [
  "#22c55e",
  "#38bdf8",
  "#a78bfa",
  "#f472b6",
  "#fbbf24",
  "#2dd4bf",
  "#fb7185",
  "#94a3b8",
];

function pivotByDate(
  points: CultivationStrainMetricPoint[],
  acronyms: string[],
  field: "potencyPct" | "dryYieldGPerSqFt",
): Record<string, string | number>[] {
  const want = new Set(acronyms.map((a) => a.toUpperCase()));
  const byDate = new Map<string, Record<string, number | string>>();

  for (const p of points) {
    const ac = p.strainAcronym.toUpperCase();
    if (want.size > 0 && !want.has(ac)) continue;
    const v = p[field];
    if (v == null || !Number.isFinite(v)) continue;
    const row = byDate.get(p.date) || { date: p.date };
    row[ac] = v;
    byDate.set(p.date, row);
  }

  return [...byDate.values()].sort((a, b) =>
    String(a.date).localeCompare(String(b.date)),
  );
}

export default function AnalyticsPage() {
  const [{ from, to }, setRange] = useState(defaultDateRange);
  const [strains, setStrains] = useState<ConfigStrain[]>([]);
  const [selectedAcronyms, setSelectedAcronyms] = useState<string[]>([]);
  const [points, setPoints] = useState<CultivationStrainMetricPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiRequest<{
          cultivation?: { strains?: ConfigStrain[] };
          strains?: ConfigStrain[];
        }>("/api/config");
        const raw = data?.cultivation?.strains ?? data?.strains ?? [];
        const list = Array.isArray(raw) ? raw : [];
        if (!cancelled) {
          setStrains(
            list.filter((s) => getStrainAcronym(s as ConfigStrain)),
          );
        }
      } catch {
        if (!cancelled) setStrains([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const out = await fetchCultivationStrainMetrics({
        from,
        to,
        strains: selectedAcronyms.length > 0 ? selectedAcronyms : undefined,
      });
      setPoints(Array.isArray(out.points) ? out.points : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load analytics");
      setPoints([]);
    } finally {
      setLoading(false);
    }
  }, [from, to, selectedAcronyms]);

  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics]);

  const acronymsForChart = useMemo(() => {
    if (selectedAcronyms.length > 0) return selectedAcronyms.map((a) => a.toUpperCase());
    const set = new Set<string>();
    for (const p of points) set.add(p.strainAcronym.toUpperCase());
    return [...set];
  }, [points, selectedAcronyms]);

  const potencyRows = useMemo(
    () => pivotByDate(points, acronymsForChart, "potencyPct"),
    [points, acronymsForChart],
  );
  const yieldRows = useMemo(
    () => pivotByDate(points, acronymsForChart, "dryYieldGPerSqFt"),
    [points, acronymsForChart],
  );

  const pageStyle = {
    minHeight: "100vh",
    background:
      "radial-gradient(circle at top, #1e293b 0, #020617 45%, #020617 100%)",
    color: "white",
    padding: 20,
  } as const;

  const cardStyle = {
    background: "rgba(15, 23, 42, 0.9)",
    border: "1px solid #334155",
    borderRadius: 18,
    padding: 18,
    marginBottom: 18,
    boxShadow: "0 18px 40px rgba(0,0,0,0.25)",
  } as const;

  const inputStyle = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #475569",
    background: "#0f172a",
    color: "white",
    fontWeight: 600,
  } as const;

  function toggleStrain(ac: string) {
    const u = ac.toUpperCase();
    setSelectedAcronyms((prev) =>
      prev.includes(u) ? prev.filter((x) => x !== u) : [...prev, u],
    );
  }

  return (
    <PageAccessGate permission="page.analytics">
      <main style={pageStyle}>
        <Nav />
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <h1 style={{ textAlign: "center", marginBottom: 8 }}>Analytics</h1>
          <p style={{ textAlign: "center", color: "#94a3b8", marginTop: 0 }}>
            Cultivation strain metrics from batches with lab THC % and dry yield (g / sq ft allocated to dry harvest).
          </p>

          <section style={cardStyle}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ color: "#94a3b8", fontSize: 13 }}>From</span>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                  style={inputStyle}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ color: "#94a3b8", fontSize: 13 }}>To</span>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                  style={inputStyle}
                />
              </label>
              <button
                type="button"
                onClick={() => void loadMetrics()}
                style={{
                  marginTop: 22,
                  padding: "10px 18px",
                  borderRadius: 10,
                  border: "1px solid #22c55e",
                  background: "#14532d",
                  color: "white",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Refresh
              </button>
            </div>

            <h3 style={{ marginTop: 0, color: "#e2e8f0" }}>Strains</h3>
            <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 0 }}>
              Leave all unchecked to include every strain returned in the date range.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {strains.map((s) => {
                const ac = getStrainAcronym(s);
                if (!ac) return null;
                const on = selectedAcronyms.includes(ac);
                return (
                  <label
                    key={ac}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 12px",
                      borderRadius: 10,
                      border: on ? "1px solid #22c55e" : "1px solid #475569",
                      background: on ? "rgba(34,197,94,0.12)" : "#0f172a",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleStrain(ac)}
                    />
                    <span>{getStrainLabel(s)}</span>
                  </label>
                );
              })}
            </div>
          </section>

          {loading && (
            <p style={{ textAlign: "center", color: "#94a3b8" }}>Loading…</p>
          )}
          {error && (
            <p style={{ textAlign: "center", color: "#fca5a5" }}>{error}</p>
          )}

          {!loading && !error && points.length === 0 && (
            <p style={{ textAlign: "center", color: "#94a3b8" }}>
              No data in this range. Metrics appear after dry flower Test Passed with lab THC % (and parent cultivation
              batch has harvest / table data).
            </p>
          )}

          {points.length > 0 && (
            <>
              <section style={cardStyle}>
                <h3 style={{ marginTop: 0 }}>Potency (lab THC %)</h3>
                <div style={{ width: "100%", height: 360 }}>
                  <ResponsiveContainer>
                    <LineChart data={potencyRows}>
                      <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                      <XAxis dataKey="date" stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" domain={["auto", "auto"]} />
                      <Tooltip
                        contentStyle={{
                          background: "#0f172a",
                          border: "1px solid #334155",
                          borderRadius: 8,
                        }}
                      />
                      <Legend />
                      {acronymsForChart.map((ac, i) => (
                        <Line
                          key={ac}
                          type="monotone"
                          dataKey={ac}
                          stroke={STRAIN_COLORS[i % STRAIN_COLORS.length]}
                          dot={{ r: 3 }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section style={cardStyle}>
                <h3 style={{ marginTop: 0 }}>Dry yield (g / sq ft)</h3>
                <div style={{ width: "100%", height: 360 }}>
                  <ResponsiveContainer>
                    <LineChart data={yieldRows}>
                      <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                      <XAxis dataKey="date" stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" domain={["auto", "auto"]} />
                      <Tooltip
                        contentStyle={{
                          background: "#0f172a",
                          border: "1px solid #334155",
                          borderRadius: 8,
                        }}
                      />
                      <Legend />
                      {acronymsForChart.map((ac, i) => (
                        <Line
                          key={`y-${ac}`}
                          type="monotone"
                          dataKey={ac}
                          stroke={STRAIN_COLORS[i % STRAIN_COLORS.length]}
                          dot={{ r: 3 }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </PageAccessGate>
  );
}
