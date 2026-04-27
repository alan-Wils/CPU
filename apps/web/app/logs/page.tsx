"use client";

import { useEffect, useState } from "react";
import Nav from "@/components/Nav";
import PageAccessGate from "@/components/PageAccessGate";
import { getAuthUser } from "@/lib/auth";
import { getApiErrorMessage, getLogs } from "@/lib/api";

type ActivityPayload = {
  items: Array<{ id: string; kind: "audit" | "task"; when: string; summary: string; actor?: string }>;
};

export default function LogsPage() {
  const [data, setData] = useState<ActivityPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const user = getAuthUser();

  useEffect(() => {
    let active = true;
    let lastSig = "";

    const load = () =>
      getLogs()
      .then((rows: any) => {
        if (Array.isArray(rows?.items)) {
          const sig = `${rows.items.length}:${rows.items[0]?.id || ""}:${rows.items[0]?.when || ""}`;
          if (sig !== lastSig && active) {
            lastSig = sig;
            setData({ items: rows.items });
          }
        } else if (Array.isArray(rows)) {
          const sig = `${rows.length}:${rows[0]?.id || ""}:${rows[0]?.when || ""}`;
          if (sig !== lastSig && active) {
            lastSig = sig;
            setData({ items: rows });
          }
        } else {
          if (active) setData({ items: [] });
        }
      })
      .catch((e) => setError(getApiErrorMessage(e, "Failed to load logs")));
    load();
    const interval = setInterval(load, 1000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <PageAccessGate allowedRoles={["VIEW_ONLY"]}>
      <main
        style={{
          minHeight: "100vh",
          background:
            "radial-gradient(circle at top left, rgba(34,197,94,0.08), transparent 28%), radial-gradient(circle at top right, rgba(56,189,248,0.08), transparent 33%), #020617",
          color: "white",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>
          <Nav />

          <header
            style={{
              background: "rgba(15, 23, 42, 0.82)",
              border: "1px solid rgba(148, 163, 184, 0.22)",
              borderRadius: 22,
              padding: 22,
              boxShadow: "0 24px 70px rgba(0,0,0,0.35)",
              marginBottom: 20,
            }}
          >
            <h1 style={{ margin: 0, fontSize: 38, fontWeight: 950, letterSpacing: "-0.04em" }}>
              All Logs
            </h1>
            <p style={{ color: "#cbd5e1", marginTop: 8, marginBottom: 0 }}>
              Company-scoped merged audit + task stream.
            </p>
          </header>

          {error ? (
            <div
              style={{
                marginBottom: 14,
                borderRadius: 14,
                border: "1px solid rgba(248, 113, 113, 0.45)",
                background: "rgba(127, 29, 29, 0.5)",
                color: "#fecaca",
                padding: 14,
                fontWeight: 700,
              }}
            >
              {error}
            </div>
          ) : null}

          <section
            style={{
              background: "rgba(15, 23, 42, 0.82)",
              border: "1px solid rgba(148, 163, 184, 0.22)",
              borderRadius: 20,
              padding: 18,
              boxShadow: "0 22px 60px rgba(0,0,0,0.32)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 14,
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <h2 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Activity Feed</h2>
              <div
                style={{
                  display: "inline-flex",
                  padding: "7px 11px",
                  borderRadius: 999,
                  background: "rgba(168, 85, 247, 0.16)",
                  border: "1px solid rgba(168, 85, 247, 0.45)",
                  color: "#d8b4fe",
                  fontWeight: 900,
                  fontSize: 13,
                }}
              >
                {String(user?.role || "VIEW_ONLY").toUpperCase()}
              </div>
            </div>

            <div style={{ maxHeight: 620, overflow: "auto", paddingRight: 4 }}>
              <ul style={{ display: "grid", gap: 10, margin: 0, padding: 0, listStyle: "none" }}>
                {data?.items.map((i) => (
                  <li
                    key={`${i.kind}-${i.id}`}
                    style={{
                      borderRadius: 14,
                      border: "1px solid rgba(148, 163, 184, 0.2)",
                      background: "rgba(2, 6, 23, 0.72)",
                      padding: 12,
                      fontSize: 14,
                    }}
                  >
                    <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 6 }}>{i.when}</div>
                    <div>
                      <span
                        style={{
                          marginRight: 8,
                          borderRadius: 999,
                          border: "1px solid rgba(148, 163, 184, 0.28)",
                          background: "rgba(15, 23, 42, 0.92)",
                          padding: "3px 8px",
                          fontSize: 11,
                          fontWeight: 900,
                          letterSpacing: "0.06em",
                        }}
                      >
                        {i.kind}
                      </span>
                      {i.summary}
                    </div>
                  </li>
                ))}
                {(data?.items?.length || 0) === 0 ? (
                  <li style={{ color: "#94a3b8", padding: 8 }}>No logs found.</li>
                ) : null}
              </ul>
            </div>
          </section>
        </div>
      </main>
    </PageAccessGate>
  );
}
