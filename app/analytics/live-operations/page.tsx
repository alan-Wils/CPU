"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Nav from "@/components/Nav";
import PageAccessGate from "@/components/PageAccessGate";
import {
  fetchAnalyticsLiveOperations,
  type AnalyticsLiveOperationsJson,
  type LiveOperationsCardJson,
} from "@/lib/analyticsLiveOperationsApi";
import { SilentRefreshToast } from "@/components/analytics/SilentRefreshToast";

function formatTs(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : iso;
}

function TaskLogRows({ items }: { items: Record<string, unknown>[] }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {items.map((row, i) => (
        <li
          key={String(row.id ?? i)}
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid rgba(30,41,59,0.9)",
            fontSize: 13,
            color: "#e2e8f0",
          }}
        >
          <div style={{ fontWeight: 700 }}>{String(row.stage ?? "—")}</div>
          <div style={{ color: "#94a3b8", marginTop: 4 }}>
            {row.minutes != null ? `${row.minutes}m` : "—"} · ref {String(row.referenceId ?? "—")} ·{" "}
            {String(row.loggedBy ?? "—")}
          </div>
          {row.note ? (
            <div style={{ color: "#64748b", marginTop: 4, fontSize: 12 }}>{String(row.note)}</div>
          ) : null}
          <div style={{ color: "#64748b", marginTop: 4, fontSize: 11 }}>{formatTs(String(row.at ?? ""))}</div>
        </li>
      ))}
    </ul>
  );
}

function ExtractionRows({ items }: { items: Record<string, unknown>[] }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {items.map((row, i) => (
        <li
          key={String(row.id ?? i)}
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid rgba(30,41,59,0.9)",
            fontSize: 13,
            color: "#e2e8f0",
          }}
        >
          <div style={{ fontWeight: 700 }}>{String(row.phase ?? "—")}</div>
          <div style={{ color: "#94a3b8", marginTop: 4 }}>
            Batch <span style={{ color: "#cbd5e1" }}>{String(row.cultivationBatchId ?? "—")}</span>
          </div>
          <div style={{ color: "#64748b", marginTop: 4, fontSize: 11 }}>{formatTs(String(row.updatedAt ?? ""))}</div>
        </li>
      ))}
    </ul>
  );
}

function PackagingRows({ items }: { items: Record<string, unknown>[] }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {items.map((row, i) => (
        <li
          key={String(row.id ?? i)}
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid rgba(30,41,59,0.9)",
            fontSize: 13,
            color: "#e2e8f0",
          }}
        >
          <div style={{ fontWeight: 700 }}>{String(row.sku ?? "—")}</div>
          <div style={{ color: "#94a3b8", marginTop: 4 }}>
            {row.units != null ? `${row.units} units` : "—"} · run {String(row.extractionRunId ?? "—").slice(0, 8)}…
          </div>
          <div style={{ color: "#64748b", marginTop: 4, fontSize: 11 }}>{formatTs(String(row.updatedAt ?? ""))}</div>
        </li>
      ))}
    </ul>
  );
}

function LaborRows({ items }: { items: Record<string, unknown>[] }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {items.map((row, i) => (
        <li
          key={String(row.id ?? i)}
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid rgba(30,41,59,0.9)",
            fontSize: 13,
            color: "#e2e8f0",
          }}
        >
          <div style={{ fontWeight: 700 }}>{String(row.stage ?? "—")}</div>
          <div style={{ color: "#94a3b8", marginTop: 4 }}>
            {row.hours != null ? `${Number(row.hours).toFixed(2)}h` : "—"} ·{" "}
            {row.totalCost != null ? `$${Number(row.totalCost).toFixed(2)}` : "—"} · {String(row.userEmail ?? "—")}
          </div>
          <div style={{ color: "#64748b", marginTop: 4, fontSize: 11 }}>
            {String(row.taskType ?? "")}
            {row.referenceId ? ` · ref ${String(row.referenceId)}` : ""}
            {row.cultivationBatchId ? ` · batch ${String(row.cultivationBatchId).slice(0, 8)}…` : ""}
          </div>
          <div style={{ color: "#64748b", marginTop: 4, fontSize: 11 }}>{formatTs(String(row.at ?? ""))}</div>
        </li>
      ))}
    </ul>
  );
}

function CardBody({ card }: { card: LiveOperationsCardJson }) {
  const scrollStyle = {
    maxHeight: "min(40vh, 360px)",
    overflowY: "auto" as const,
    borderRadius: 10,
    border: "1px solid #1e293b",
    background: "#020617",
  };
  switch (card.id) {
    case "task_logs":
      return (
        <div style={scrollStyle}>
          <TaskLogRows items={card.items} />
        </div>
      );
    case "extraction":
      return (
        <div style={scrollStyle}>
          <ExtractionRows items={card.items} />
        </div>
      );
    case "packaging":
      return (
        <div style={scrollStyle}>
          <PackagingRows items={card.items} />
        </div>
      );
    case "labor":
      return (
        <div style={scrollStyle}>
          <LaborRows items={card.items} />
        </div>
      );
    default:
      return (
        <div style={{ ...scrollStyle, padding: 12, color: "#94a3b8", fontSize: 13 }}>
          Unknown card type: {card.id}
        </div>
      );
  }
}

export default function AnalyticsLiveOperationsPage() {
  const [data, setData] = useState<AnalyticsLiveOperationsJson | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [silentRefreshPulse, setSilentRefreshPulse] = useState(0);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const out = await fetchAnalyticsLiveOperations();
      setData(out);
      if (silent) {
        setError(null);
        setSilentRefreshPulse((p) => p + 1);
      }
    } catch (e) {
      if (!silent) {
        setData(null);
        setError(e instanceof Error ? e.message : "Failed to load live operations");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!data?.cards?.length) return;
    const h = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    if (!h.startsWith("live-ops-card-")) return;
    const cardId = h.slice("live-ops-card-".length);
    if (data.cards.some((c) => c.id === cardId)) setExpandedId(cardId);
  }, [data]);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const tick = async () => {
      if (cancelled || inFlight || document.hidden) return;
      inFlight = true;
      try {
        await load({ silent: true });
      } finally {
        inFlight = false;
      }
    };

    const id = window.setInterval(() => {
      void tick();
    }, 45_000);
    const boot = window.setTimeout(() => {
      void tick();
    }, 1200);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.clearTimeout(boot);
    };
  }, [load]);

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
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ marginBottom: 20 }}>
            <Link href="/analytics" style={{ color: "#38bdf8", fontSize: 14, textDecoration: "none" }}>
              ← Analytics
            </Link>
          </div>
          <h1 style={{ margin: "0 0 8px", fontSize: 26, fontWeight: 800 }}>Live operations</h1>
          <p style={{ margin: "0 0 20px", color: "#94a3b8", fontSize: 14, maxWidth: 720 }}>
            Task logs (14 days, linked to a reference), active extraction and packaging work, and labor logged today
            in UTC. Expand a card for the full scrollable list. Data refreshes every 45 seconds while this tab is
            visible.
          </p>
          {loading ? <p style={{ color: "#94a3b8" }}>Loading…</p> : null}
          {error ? <p style={{ color: "#fca5a5" }}>{error}</p> : null}
          {data?.generatedAt ? (
            <p style={{ color: "#64748b", fontSize: 12, marginBottom: 16 }}>
              Generated {new Date(data.generatedAt).toLocaleString()}
            </p>
          ) : null}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 16,
            }}
          >
            {(data?.cards ?? []).map((card) => {
              const open = expandedId === card.id;
              return (
                <div
                  key={card.id}
                  id={`live-ops-card-${card.id}`}
                  style={{
                    borderRadius: 14,
                    border: "1px solid rgba(51,65,85,0.85)",
                    background: "linear-gradient(145deg, rgba(15,23,42,0.95), rgba(2,6,23,0.98))",
                    boxShadow: "0 12px 28px rgba(0,0,0,0.35)",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 0,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setExpandedId(open ? null : card.id)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "14px 16px",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: "inherit",
                    }}
                  >
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#f1f5f9" }}>{card.title}</div>
                    <div style={{ marginTop: 6, fontSize: 13, color: "#94a3b8" }}>{card.summary}</div>
                    <div style={{ marginTop: 8, fontSize: 12, color: "#64748b" }}>
                      {open ? "Click to collapse" : "Click to expand"}
                    </div>
                  </button>
                  {open ? (
                    <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                      <CardBody card={card} />
                      {card.href ? (
                        <Link
                          href={card.href}
                          style={{ color: "#38bdf8", fontSize: 13, textDecoration: "none", fontWeight: 600 }}
                        >
                          Open workspace →
                        </Link>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
        <SilentRefreshToast pulse={silentRefreshPulse} />
      </main>
    </PageAccessGate>
  );
}
