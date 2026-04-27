"use client";

import Nav from "@/components/Nav";
import { getAuthUser } from "@/lib/auth";

const dashboardCards = [
  {
    title: "Cultivation",
    description:
      "Create clone batches, move plants through veg and flower, harvest, dry, cure, and prepare source material.",
    href: "/cultivation",
    accent: "#22c55e",
  },
  {
    title: "Extraction",
    description:
      "Create extraction batches from source material, track sock packing, extraction runs, purge, testing, and final oil.",
    href: "/extraction",
    accent: "#38bdf8",
  },
  {
    title: "Packaging",
    description:
      "Package approved extraction products, track units, task labor, testing, relabeling, and finished package sets.",
    href: "/packaging",
    accent: "#a855f7",
  },
  {
    title: "Data Hub",
    description:
      "Review batch chains, source material flow, production history, labor cost, yield, and company-wide batch data.",
    href: "/data-hub",
    accent: "#f59e0b",
  },
];

export default function Home() {
  const user = getAuthUser();
  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(34,197,94,0.18), transparent 32%), radial-gradient(circle at top right, rgba(56,189,248,0.14), transparent 35%), #020617",
        color: "white",
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 1180,
          margin: "0 auto",
        }}
      >
        <header
          style={{
            background: "rgba(15, 23, 42, 0.82)",
            border: "1px solid rgba(148, 163, 184, 0.22)",
            borderRadius: 24,
            padding: 28,
            boxShadow: "0 24px 70px rgba(0,0,0,0.35)",
            marginBottom: 22,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 18,
              alignItems: "flex-start",
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  background: "rgba(34, 197, 94, 0.12)",
                  color: "#86efac",
                  border: "1px solid rgba(34, 197, 94, 0.28)",
                  padding: "7px 12px",
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 800,
                  marginBottom: 14,
                }}
              >
                Live Company Workspace
              </div>

              <h1
                style={{
                  fontSize: "clamp(34px, 5vw, 58px)",
                  lineHeight: 1,
                  margin: 0,
                  letterSpacing: "-0.05em",
                  fontWeight: 950,
                }}
              >
                CPU Tracking System
              </h1>

              <p
                style={{
                  maxWidth: 760,
                  color: "#cbd5e1",
                  fontSize: 18,
                  lineHeight: 1.6,
                  marginTop: 16,
                  marginBottom: 0,
                }}
              >
                Track cultivation, extraction, packaging, labor, source
                material, batch flow, and production data from one shared
                company system.
              </p>
            </div>

            <div
              style={{
                minWidth: 220,
                background: "rgba(2, 6, 23, 0.74)",
                border: "1px solid rgba(148, 163, 184, 0.18)",
                borderRadius: 18,
                padding: 16,
              }}
            >
              <div
                style={{
                  color: "#94a3b8",
                  fontSize: 13,
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 8,
                }}
              >
                Current Access
              </div>
              <div style={{ fontSize: 24, fontWeight: 900 }}>
                {user?.companyCode ? String(user.companyCode).toUpperCase() : "Active Workspace"}
              </div>
              <div style={{ color: "#64748b", marginTop: 4 }}>
                Signed-in company context
              </div>
            </div>
          </div>

          <div style={{ marginTop: 24 }}>
            <Nav />
          </div>
        </header>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(245px, 1fr))",
            gap: 18,
            marginBottom: 22,
          }}
        >
          {dashboardCards.map((card) => (
            <a
              key={card.title}
              href={card.href}
              style={{
                display: "block",
                textDecoration: "none",
                color: "white",
                background: "rgba(15, 23, 42, 0.78)",
                border: "1px solid rgba(148, 163, 184, 0.2)",
                borderRadius: 22,
                padding: 22,
                minHeight: 205,
                boxShadow: "0 18px 50px rgba(0,0,0,0.28)",
                transition:
                  "transform 160ms ease, border-color 160ms ease, background 160ms ease",
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 14,
                  background: `${card.accent}22`,
                  border: `1px solid ${card.accent}66`,
                  marginBottom: 18,
                  boxShadow: `0 0 30px ${card.accent}22`,
                }}
              />

              <h2
                style={{
                  margin: 0,
                  fontSize: 24,
                  fontWeight: 900,
                  letterSpacing: "-0.03em",
                }}
              >
                {card.title}
              </h2>

              <p
                style={{
                  color: "#94a3b8",
                  lineHeight: 1.55,
                  marginTop: 10,
                  marginBottom: 18,
                }}
              >
                {card.description}
              </p>

              <div
                style={{
                  color: card.accent,
                  fontWeight: 900,
                }}
              >
                Open {card.title} →
              </div>
            </a>
          ))}
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 18,
          }}
        >
          <div style={infoPanelStyle}>
            <h3 style={panelTitleStyle}>Backend Status</h3>
            <p style={panelTextStyle}>
              Company-scoped records are loaded and saved through authenticated API routes.
            </p>
          </div>

          <div style={infoPanelStyle}>
            <h3 style={panelTitleStyle}>Access Context</h3>
            <p style={panelTextStyle}>
              Current role: <span style={{ color: "#c4b5fd", fontWeight: 800 }}>{user?.role || "UNKNOWN"}</span>.
              Data visibility and actions are permission scoped.
            </p>
          </div>

          <div style={infoPanelStyle}>
            <h3 style={panelTitleStyle}>Realtime Sync</h3>
            <p style={panelTextStyle}>
              Operational pages watch company updates and refresh only on actual data changes.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

const infoPanelStyle: React.CSSProperties = {
  background: "rgba(15, 23, 42, 0.7)",
  border: "1px solid rgba(148, 163, 184, 0.18)",
  borderRadius: 20,
  padding: 20,
};

const panelTitleStyle: React.CSSProperties = {
  margin: 0,
  marginBottom: 10,
  fontSize: 18,
  fontWeight: 900,
};

const panelTextStyle: React.CSSProperties = {
  color: "#94a3b8",
  lineHeight: 1.55,
  margin: 0,
};
