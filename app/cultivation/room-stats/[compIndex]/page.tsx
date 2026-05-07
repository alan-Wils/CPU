"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";
import Nav from "@/components/Nav";
import PageAccessGate from "@/components/PageAccessGate";
import { fetchAutogrowSnapshot, fetchAutogrowCompReadings } from "@/lib/api";
import { labelForAutogrowComp } from "@/lib/autogrowCompanyConfig";

function fmt(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "—";
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
        let labels:
          | { compIndex: number; label: string }[]
          | undefined;
        if (snapshot.ok) labels = snapshot.compLabels;

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

  const keysSorted = readings ? Object.keys(readings).sort((a, b) => a.localeCompare(b)) : [];

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
        ) : (
          <p style={{ color: "#94a3b8" }}>No readings.</p>
        )}
      </main>
    </PageAccessGate>
  );
}
