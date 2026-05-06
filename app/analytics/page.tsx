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

/** API / JSON may return numeric fields as strings; Recharts needs real numbers for correct Y mapping. */
function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "")
    return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeMetricPoints(raw: unknown[]): CultivationStrainMetricPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: CultivationStrainMetricPoint[] = [];
  for (const row of raw) {
    if (row == null || typeof row !== "object" || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    const batchId = String(r.batchId ?? "").trim();
    const strain = String(r.strain ?? "").trim();
    const strainAcronym = String(r.strainAcronym ?? "").trim();
    const date = String(r.date ?? "").trim();
    if (!batchId || !strainAcronym || !date) continue;
    const potencyPct = finiteNumber(r.potencyPct);
    const dryYieldGPerSqFt = finiteNumber(r.dryYieldGPerSqFt);
    out.push({
      batchId,
      strain,
      strainAcronym,
      date,
      potencyPct,
      dryYieldGPerSqFt,
    });
  }
  return out;
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

type TooltipPayloadItem = {
  dataKey?: string | number;
  name?: string;
  value?: string | number;
  color?: string;
  payload?: Record<string, unknown>;
};

function StrainMetricTooltip(props: {
  active?: boolean;
  label?: string;
  payload?: TooltipPayloadItem[];
  valueSuffix?: string;
}) {
  const { active, label, payload, valueSuffix = "" } = props;
  if (!active || !payload?.length) return null;
  const row = (payload[0]?.payload ?? {}) as Record<string, unknown>;
  const batchId = row.batchId != null ? String(row.batchId) : "";
  const entries = payload
    .map((it) => {
      const n = finiteNumber(it.value);
      if (n == null) return null;
      return { ...it, value: n };
    })
    .filter(Boolean) as Array<TooltipPayloadItem & { value: number }>;
  if (entries.length === 0) return null;
  return (
    <div
      style={{
        background: "#0f172a",
        border: "1px solid #334155",
        borderRadius: 8,
        padding: "10px 12px",
        fontSize: 13,
        color: "#e2e8f0",
      }}
    >
      {label != null && label !== "" && (
        <div style={{ marginBottom: 6, fontWeight: 700 }}>{label}</div>
      )}
      {batchId ? (
        <div style={{ color: "#94a3b8", marginBottom: 8, fontSize: 12, wordBreak: "break-all" }}>
          Batch <span style={{ color: "#e2e8f0" }}>{batchId}</span>
        </div>
      ) : null}
      {entries.map((it) => (
        <div key={String(it.dataKey)} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 99,
              background: it.color ?? "#94a3b8",
            }}
          />
          <span>
            {it.name}:{" "}
            <strong>
              {Number.isInteger(it.value) ? String(it.value) : it.value.toFixed(1)}
            </strong>
            {valueSuffix}
          </span>
        </div>
      ))}
    </div>
  );
}

/** One Recharts series per strain so multiple batches form a connected line over time. */
function seriesKeyForPoint(p: CultivationStrainMetricPoint) {
  return p.strainAcronym.toUpperCase();
}

function displayNameForAcronym(
  acronym: string,
  fromPoints: CultivationStrainMetricPoint[],
) {
  const hit = fromPoints.find((p) => p.strainAcronym.toUpperCase() === acronym);
  const name = String(hit?.strain ?? "").trim();
  return name ? `${name} (${acronym})` : acronym;
}

/** Distinct x tick so same calendar day + same strain does not collapse multiple harvests. */
function xTickForPoint(p: CultivationStrainMetricPoint) {
  const id = p.batchId;
  const tail = id.includes("-") ? (id.split("-").pop() ?? id.slice(-8)) : id.slice(-8);
  return `${p.date} · ${tail}`;
}

/**
 * Wide rows for Recharts: one row per API point, unique `xTick`, one numeric column per series key.
 * (Old pivot-by-date-only dropped every batch but the last whenever two shared a lab result date.)
 */
function buildStrainMetricCharts(
  points: CultivationStrainMetricPoint[],
  acronyms: string[],
): {
  potencyRows: Record<string, string | number | undefined>[];
  yieldRows: Record<string, string | number | undefined>[];
  seriesKeys: string[];
} {
  const want = new Set(acronyms.map((a) => a.toUpperCase()));
  const filtered = points
    .filter((p) => want.size === 0 || want.has(p.strainAcronym.toUpperCase()))
    .filter((p) => {
      const potN = finiteNumber(p.potencyPct);
      const yldN = finiteNumber(p.dryYieldGPerSqFt);
      const pot = potN != null;
      const yld = yldN != null && yldN > 0;
      return pot || yld;
    })
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.batchId.localeCompare(b.batchId),
    );

  const seriesKeys = [...new Set(filtered.map(seriesKeyForPoint))].sort();

  const potencyRows: Record<string, string | number | undefined>[] = [];
  const yieldRows: Record<string, string | number | undefined>[] = [];

  for (const p of filtered) {
    const sk = seriesKeyForPoint(p);
    const base = {
      xTick: xTickForPoint(p),
      date: p.date,
      batchId: p.batchId,
    };
    const pr: Record<string, string | number | undefined> = { ...base };
    const yr: Record<string, string | number | undefined> = { ...base };
    for (const k of seriesKeys) {
      pr[k] = undefined;
      yr[k] = undefined;
    }
    const potN = finiteNumber(p.potencyPct);
    const yldN = finiteNumber(p.dryYieldGPerSqFt);
    if (potN != null) pr[sk] = potN;
    if (yldN != null && yldN > 0) yr[sk] = yldN;
    potencyRows.push(pr);
    yieldRows.push(yr);
  }

  return { potencyRows, yieldRows, seriesKeys };
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
      setPoints(normalizeMetricPoints(Array.isArray(out.points) ? out.points : []));
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

  const { potencyRows, yieldRows, seriesKeys: metricSeriesKeys } = useMemo(
    () => buildStrainMetricCharts(points, acronymsForChart),
    [points, acronymsForChart],
  );

  const potencyYDomain = useMemo((): [number, number] | undefined => {
    const vals: number[] = [];
    for (const row of potencyRows) {
      for (const sk of metricSeriesKeys) {
        const n = finiteNumber(row[sk]);
        if (n != null) vals.push(n);
      }
    }
    if (vals.length === 0) return undefined;
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (lo === hi) {
      lo -= 0.5;
      hi += 0.5;
    }
    const span = hi - lo;
    const pad = Math.max(0.25, span * 0.08);
    return [Math.floor((lo - pad) * 10) / 10, Math.ceil((hi + pad) * 10) / 10];
  }, [potencyRows, metricSeriesKeys]);

  const yieldYDomain = useMemo((): [number, number] | undefined => {
    const vals: number[] = [];
    for (const row of yieldRows) {
      for (const sk of metricSeriesKeys) {
        const n = finiteNumber(row[sk]);
        if (n != null && n > 0) vals.push(n);
      }
    }
    if (vals.length === 0) return undefined;
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (lo === hi) {
      lo = Math.max(0, lo * 0.92);
      hi = hi * 1.08;
    }
    const span = hi - lo;
    const pad = Math.max(span * 0.06, 0.01);
    return [+Math.max(0, lo - pad).toFixed(3), +(hi + pad).toFixed(3)];
  }, [yieldRows, metricSeriesKeys]);

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
            Cultivation strain metrics from lab THC % and dry yield (g / sq ft) per dry flower batch when synced to the
            server; each point uses the lab result date saved at <strong>Test Passed</strong>. Multiple burping batches
            share one parent cultivation id but plot as separate points (date · batch id). Lines connect batches of the
            same strain in time order; hover a point for the full batch id.
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
            <p style={{ textAlign: "center", color: "#94a3b8", maxWidth: 720, margin: "24px auto 0", lineHeight: 1.6 }}>
              No data in this range. Each point uses the cultivation batch lab result{" "}
              <strong>date</strong>
              {" "}
              captured when dry flower <strong>Test Passed</strong> saves to the server. Extend <strong>To</strong> to
              cover that calendar day (and <strong>From</strong> as needed), or clear strain checkboxes to include every
              strain. If saves failed when passing testing, Cultivation analytics will stay empty until the parent batch
              sync succeeds—check connectivity and retry.
            </p>
          )}

          {points.length > 0 && (
            <>
              <section style={cardStyle}>
                <h3 style={{ marginTop: 0 }}>Potency (lab THC %)</h3>
                <div style={{ width: "100%", height: 360 }}>
                  <ResponsiveContainer>
                    <LineChart data={potencyRows} margin={{ bottom: 28, left: 8, right: 8 }}>
                      <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="xTick"
                        stroke="#94a3b8"
                        interval={0}
                        angle={-22}
                        textAnchor="end"
                        height={72}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis
                        stroke="#94a3b8"
                        domain={potencyYDomain ?? ["auto", "auto"]}
                        tickFormatter={(v) => (typeof v === "number" ? v.toFixed(1) : String(v))}
                        allowDataOverflow
                      />
                      <Tooltip content={(tp) => <StrainMetricTooltip {...tp} valueSuffix=" %" />} />
                      <Legend />
                      {metricSeriesKeys.map((sk, i) => (
                        <Line
                          key={sk}
                          type="monotone"
                          dataKey={sk}
                          name={displayNameForAcronym(sk, points)}
                          stroke={STRAIN_COLORS[i % STRAIN_COLORS.length]}
                          strokeWidth={2}
                          dot={{ r: 4 }}
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
                    <LineChart data={yieldRows} margin={{ bottom: 28, left: 8, right: 8 }}>
                      <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="xTick"
                        stroke="#94a3b8"
                        interval={0}
                        angle={-22}
                        textAnchor="end"
                        height={72}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis
                        stroke="#94a3b8"
                        domain={yieldYDomain ?? ["auto", "auto"]}
                        tickFormatter={(v) => (typeof v === "number" ? v.toFixed(2) : String(v))}
                        allowDataOverflow
                      />
                      <Tooltip content={(tp) => <StrainMetricTooltip {...tp} valueSuffix=" g/sq ft" />} />
                      <Legend />
                      {metricSeriesKeys.map((sk, i) => (
                        <Line
                          key={`y-${sk}`}
                          type="monotone"
                          dataKey={sk}
                          name={displayNameForAcronym(sk, points)}
                          stroke={STRAIN_COLORS[i % STRAIN_COLORS.length]}
                          strokeWidth={2}
                          dot={{ r: 4 }}
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
