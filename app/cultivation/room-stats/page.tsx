"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import Nav from "@/components/Nav";
import PageAccessGate from "@/components/PageAccessGate";
import { fetchAutogrowSnapshot, type AutogrowSnapshotDto } from "@/lib/api";
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
  padding: "16px 18px",
  background: "#0f172a",
};

export default function CultivationRoomStatsPage() {
  const [snapshot, setSnapshot] = useState<AutogrowSnapshotDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const raw = await fetchAutogrowSnapshot();
        if (cancelled) return;
        setSnapshot(raw);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const okSnap = snapshot && snapshot.ok === true ? snapshot : null;
  const w = okSnap?.weather;

  return (
    <PageAccessGate permission="page.cultivation">
      <main style={pageStyle}>
        <Nav />
        <div style={{ marginBottom: 22, marginTop: 8 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 10 }}>
            <Link
              href="/cultivation"
              style={{ color: "#67e8f9", fontWeight: 700, textDecoration: "none", fontSize: 14 }}
            >
              ← Cultivation
            </Link>
            <h1 style={{ margin: 0, fontSize: "clamp(1.35rem, 3vw, 1.85rem)", fontWeight: 900 }}>
              Room stats (Autogrow)
            </h1>
          </div>
          <p style={{ color: "#94a3b8", margin: 0, maxWidth: 720, fontSize: 14, lineHeight: 1.55 }}>
            Live compartment readings from your MultiGrow device. Labels come from Admin → Climate control → Autogrow
            zone names; configure the API key and UUID there first.
          </p>
        </div>

        {loading ? (
          <p style={{ color: "#94a3b8" }}>Loading readings…</p>
        ) : err ? (
          <div style={{ ...cardStyle, borderColor: "#991b1b", color: "#fecaca", maxWidth: 640 }}>
            {err}
          </div>
        ) : snapshot && snapshot.ok === false ? (
          <div style={{ ...cardStyle, maxWidth: 640, color: "#fecaca", borderColor: "#991b1b" }}>
            {snapshot.message}
          </div>
        ) : okSnap ? (
          <>
            {w?.readings && (
              <section style={{ ...cardStyle, marginBottom: 20 }}>
                <h2 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 900, color: "#a5f3fc" }}>Weather</h2>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
                  {(["air_temp", "rh", "vpd", "solar_rad", "solar_par", "pressure"] as const).map((k) => (
                    <div key={k} style={{ padding: "8px 10px", background: "#020617", borderRadius: 8, border: "1px solid #1e293b" }}>
                      <div style={{ color: "#64748b", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>{k}</div>
                      <div style={{ fontWeight: 800, marginTop: 4 }}>{fmt(w.readings![k])}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {!w?.ok ? (
              <p style={{ color: "#fcd34d", fontSize: 14, marginBottom: 14 }}>{w?.message || "Weather data unavailable."}</p>
            ) : null}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
              {okSnap.comps
                .filter((c) => c.ok && c.readings)
                .map((c) => {
                  const r = c.readings!;
                  const title = labelForAutogrowComp(c.compIndex, okSnap.compLabels);
                  return (
                    <Link
                      key={`comp-${c.compIndex}`}
                      href={`/cultivation/room-stats/${c.compIndex}`}
                      style={{ textDecoration: "none", color: "inherit" }}
                    >
                      <article style={{ ...cardStyle, cursor: "pointer", transition: "border-color .15s" }}>
                        <h3 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 900, color: "#6ee7b7" }}>{title}</h3>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 14 }}>
                          <Metric label="Air °C" v={r.air_temp} />
                          <Metric label="RH %" v={r.rh} />
                          <Metric label="VPD" v={r.vpd} />
                          <Metric label="CO₂" v={r.co2} />
                        </div>
                        <div style={{ marginTop: 12, color: "#67e8f9", fontSize: 13, fontWeight: 700 }}>View all readings →</div>
                      </article>
                    </Link>
                  );
                })}
            </div>

            {okSnap.comps.every((c) => !c.ok) ? (
              <p style={{ color: "#94a3b8" }}>No compartment data returned yet. Confirm Autogrow is enabled and the device UUID matches.</p>
            ) : null}
          </>
        ) : (
          <p style={{ color: "#94a3b8" }}>No data.</p>
        )}
      </main>
    </PageAccessGate>
  );
}

function Metric({ label, v }: { label: string; v: unknown }) {
  return (
    <div style={{ padding: "6px 0", borderBottom: "1px solid #1e293b" }}>
      <div style={{ color: "#64748b", fontSize: 11 }}>{label}</div>
      <div style={{ fontWeight: 800 }}>{fmt(v)}</div>
    </div>
  );
}
