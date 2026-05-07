"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Nav from "@/components/Nav";
import PageAccessGate from "@/components/PageAccessGate";
import {
  fetchAutogrowCompHistory,
  fetchAutogrowCompReadings,
  fetchAutogrowSnapshot,
  type AutogrowCompHistoryDto,
} from "@/lib/api";
import { labelForAutogrowComp } from "@/lib/autogrowCompanyConfig";

function fmt(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "number") return Number.isFinite(v) ? v.toFixed(2) : "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return "…";
    }
  }
  return String(v);
}

function finiteNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** `YYYY-MM-DD` from `<input type="date">` — use local calendar day, not UTC (avoids "tomorrow" presets west of UTC). */
function ymdLocalFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseYmdParts(dateYmd: string): [number, number, number] | null {
  const s = String(dateYmd || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return [y, mo, d];
}

function dateInputLocalStartEpoch(dateYmd: string): number {
  const parts = parseYmdParts(dateYmd);
  if (!parts) return 0;
  const [y, mo, d] = parts;
  const dt = new Date(y, mo - 1, d, 0, 0, 0, 0);
  return Number.isFinite(dt.getTime()) ? Math.floor(dt.getTime() / 1000) : 0;
}

function dateInputLocalEndEpoch(dateYmd: string): number {
  const parts = parseYmdParts(dateYmd);
  if (!parts) return 0;
  const [y, mo, d] = parts;
  const dt = new Date(y, mo - 1, d, 23, 59, 59, 999);
  return Number.isFinite(dt.getTime()) ? Math.floor(dt.getTime() / 1000) : 0;
}

/** Preset: local today through seven calendar days prior (inclusive span of 8 local days unless you shorten). */
function defaultRangeYmd() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 7);
  return { fromYmd: ymdLocalFromDate(from), toYmd: ymdLocalFromDate(to) };
}

/** Autogrow-friendly: avoid tight polling; refresh when tab visible. */
const GRAPH_AUTO_REFRESH_MS = 60_000;

const CHART_COLORS = [
  "#22d3ee",
  "#10b981",
  "#a78bfa",
  "#f59e0b",
  "#fb7185",
  "#60a5fa",
  "#34d399",
  "#f472b6",
];

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  background: "#020617",
  color: "#e2e8f0",
  padding: "20px clamp(14px, 3vw, 28px)",
  paddingBottom: 48,
};

const cardStyle: CSSProperties = {
  border: "1px solid #334155",
  borderRadius: 14,
  padding: "18px 20px",
  background: "#0f172a",
};

export default function CultivationRoomStatsDetailPage() {
  const routeParams = useParams<{ compIndex: string }>();
  const [compIndexNum, setCompIndexNum] = useState<number | null>(null);
  const [title, setTitle] = useState<string>("Zone");
  const [readings, setReadings] = useState<Record<string, unknown> | null>(null);
  const [meta, setMeta] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyErr, setHistoryErr] = useState("");
  const [history, setHistory] = useState<AutogrowCompHistoryDto | null>(null);
  const [{ fromYmd, toYmd }, setRange] = useState(defaultRangeYmd);
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(["air_temp", "rh", "vpd"]);

  const compKey =
    typeof routeParams?.compIndex === "string"
      ? routeParams.compIndex
      : Array.isArray(routeParams?.compIndex)
        ? routeParams.compIndex[0]
        : "";

  useEffect(() => {
    let cancelled = false;
    const trimmed = String(compKey || "").trim();
    const parsed = trimmed === "" ? Number.NaN : Number(trimmed);
    setCompIndexNum(Number.isFinite(parsed) ? parsed : null);

    if (!Number.isFinite(parsed)) {
      setErr("Invalid compartment.");
      setLoading(false);
      return undefined;
    }

    (async () => {
      setLoading(true);
      setErr("");
      setReadings(null);
      setMeta(null);
      try {
        const snapshot = await fetchAutogrowSnapshot();
        const labels = snapshot.ok ? snapshot.compLabels : undefined;
        const name = labelForAutogrowComp(parsed, labels);
        if (!cancelled) setTitle(name);

        const detail = await fetchAutogrowCompReadings(parsed);
        if (cancelled) return;
        setReadings(detail.readings);
        setMeta(detail.metadata);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [compKey]);

  const loadHistory = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (compIndexNum == null) return;
      const fromEpoch = dateInputLocalStartEpoch(fromYmd);
      const toEpoch = dateInputLocalEndEpoch(toYmd);
      if (!fromEpoch || !toEpoch || fromEpoch >= toEpoch) {
        setHistoryErr("Choose a valid From/To range.");
        return;
      }
      const silent = Boolean(opts?.silent);
      if (!silent) {
        setHistoryLoading(true);
        setHistoryErr("");
      }
      try {
        const out = await fetchAutogrowCompHistory(compIndexNum, fromEpoch, toEpoch);
        setHistory(out);
      } catch (e) {
        if (!silent) {
          setHistoryErr(e instanceof Error ? e.message : String(e));
          setHistory(null);
        }
      } finally {
        if (!silent) setHistoryLoading(false);
      }
    },
    [compIndexNum, fromYmd, toYmd],
  );

  /** Initial load + auto-refresh on interval while tab visible. */
  useEffect(() => {
    if (compIndexNum == null) return undefined;

    void loadHistory({ silent: false });

    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void loadHistory({ silent: true });
    };
    const id = window.setInterval(tick, GRAPH_AUTO_REFRESH_MS);

    const onVis = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [compIndexNum, fromYmd, toYmd, loadHistory]);

  const keysSorted = readings ? Object.keys(readings).sort((a, b) => a.localeCompare(b)) : [];
  const availableMetrics = useMemo(() => {
    const points = history?.points || [];
    const set = new Set<string>();
    for (const row of points) {
      for (const [k, v] of Object.entries(row)) {
        if (k === "time") continue;
        if (finiteNumber(v) != null) set.add(k);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [history]);

  useEffect(() => {
    if (availableMetrics.length === 0) return;
    setSelectedMetrics((prev) => {
      const kept = prev.filter((m) => availableMetrics.includes(m));
      if (kept.length > 0) return kept;
      return availableMetrics.slice(0, 3);
    });
  }, [availableMetrics]);

  const chartRows = useMemo(() => {
    const points = history?.points || [];
    return points.map((row) => {
      const d = new Date(String(row.time || ""));
      const label = Number.isFinite(d.getTime())
        ? d.toLocaleString()
        : String(row.time || "");
      const out: Record<string, string | number | null> = {
        time: String(row.time || ""),
        label,
      };
      for (const m of availableMetrics) {
        out[m] = finiteNumber(row[m]);
      }
      return out;
    });
  }, [history, availableMetrics]);

  return (
    <PageAccessGate permission="page.cultivation">
      <main style={pageStyle}>
        <Nav />
        <div style={{ marginBottom: 18, marginTop: 8 }}>
          <Link href="/cultivation/room-stats" style={{ color: "#67e8f9", fontWeight: 700, textDecoration: "none", fontSize: 14 }}>
            ← All rooms
          </Link>
          <h1 style={{ margin: "10px 0 8px", fontSize: "clamp(1.25rem, 2.6vw, 1.65rem)", fontWeight: 900 }}>
            {title}
            {compIndexNum != null ? (
              <span style={{ fontWeight: 600, fontSize: 15, color: "#64748b", marginLeft: 10 }}>
                comps/{compIndexNum}
              </span>
            ) : null}
          </h1>
        </div>

        {loading ? (
          <p style={{ color: "#94a3b8" }}>Loading…</p>
        ) : err ? (
          <div style={{ ...cardStyle, borderColor: "#991b1b", color: "#fecaca", maxWidth: 640 }}>{err}</div>
        ) : readings ? (
          <>
            <section style={{ ...cardStyle, marginBottom: 16 }}>
              <h2 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 900, letterSpacing: "0.06em", color: "#67e8f9" }}>
                History graph
              </h2>
              <p style={{ color: "#64748b", fontSize: 12, margin: "0 0 12px", lineHeight: 1.45 }}>
                Auto-refreshes about every {GRAPH_AUTO_REFRESH_MS / 1000}s while this browser tab is visible. Pauses in the
                background to reduce Autogrow load.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end", marginBottom: 12 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6, color: "#94a3b8", fontSize: 12 }}>
                  From date
                  <input
                    type="date"
                    value={fromYmd}
                    onChange={(e) => setRange((r) => ({ ...r, fromYmd: e.target.value }))}
                    style={{ background: "#020617", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 8, padding: "8px 10px" }}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6, color: "#94a3b8", fontSize: 12 }}>
                  To date
                  <input
                    type="date"
                    value={toYmd}
                    onChange={(e) => setRange((r) => ({ ...r, toYmd: e.target.value }))}
                    style={{ background: "#020617", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 8, padding: "8px 10px" }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void loadHistory()}
                  disabled={historyLoading}
                  style={{ padding: "9px 14px", borderRadius: 8, border: "1px solid #0369a1", background: "#0c4a6e", color: "#bae6fd", fontWeight: 700, cursor: "pointer" }}
                >
                  {historyLoading ? "Loading…" : "Load graph"}
                </button>
              </div>

              <div style={{ marginBottom: 12 }}>
                <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 8 }}>Select metrics</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                  {availableMetrics.map((m) => {
                    const checked = selectedMetrics.includes(m);
                    return (
                      <label key={m} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#cbd5e1" }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setSelectedMetrics((prev) => {
                              if (e.target.checked) return [...new Set([...prev, m])];
                              return prev.filter((x) => x !== m);
                            })
                          }
                        />
                        {m}
                      </label>
                    );
                  })}
                  {availableMetrics.length === 0 ? <span style={{ color: "#64748b", fontSize: 13 }}>No numeric history metrics in this range.</span> : null}
                </div>
              </div>

              {historyErr ? <p style={{ color: "#fecaca", margin: "0 0 12px" }}>{historyErr}</p> : null}
              {chartRows.length > 0 && selectedMetrics.length > 0 ? (
                <div style={{ width: "100%", height: 360, border: "1px solid #1e293b", borderRadius: 10, padding: 8, background: "#020617" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartRows}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="label" minTickGap={28} stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" />
                      <Tooltip
                        contentStyle={{ background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0" }}
                        formatter={(value: unknown) => (typeof value === "number" ? value.toFixed(2) : String(value))}
                      />
                      {selectedMetrics.map((m, idx) => (
                        <Line
                          key={m}
                          type="monotone"
                          dataKey={m}
                          stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                          dot={false}
                          connectNulls
                          strokeWidth={2}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p style={{ color: "#64748b", marginBottom: 0 }}>Pick one or more metrics and load a date range to see line data.</p>
              )}
            </section>

            <section style={{ ...cardStyle }}>
              {meta && Object.keys(meta).length > 0 && (
                <details style={{ marginBottom: 16, fontSize: 13, color: "#94a3b8" }}>
                  <summary style={{ cursor: "pointer", color: "#a5f3fc", fontWeight: 700 }}>Metadata</summary>
                  <pre
                    style={{
                      marginTop: 10,
                      padding: 12,
                      overflow: "auto",
                      borderRadius: 8,
                      background: "#020617",
                      border: "1px solid #1e293b",
                    }}
                  >
                    {fmt(meta)}
                  </pre>
                </details>
              )}

              <h2 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 900, letterSpacing: "0.06em", color: "#67e8f9" }}>
                Readings (full)
              </h2>

              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", fontSize: 14, width: "100%", minWidth: 360 }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid #334155", color: "#94a3b8" }}>
                      <th style={{ padding: "8px 10px 8px 0" }}>Key</th>
                      <th style={{ padding: "8px 0" }}>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keysSorted.map((k) => (
                      <tr key={k} style={{ borderBottom: "1px solid #1e293b" }}>
                        <td style={{ padding: "8px 10px 8px 0", fontFamily: "ui-monospace, monospace", color: "#93c5fd" }}>
                          {k}
                        </td>
                        <td style={{ padding: "8px 0", wordBreak: "break-word" }}>{fmt(readings[k])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : (
          <p style={{ color: "#94a3b8" }}>No readings.</p>
        )}
      </main>
    </PageAccessGate>
  );
}
