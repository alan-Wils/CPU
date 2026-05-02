import Nav from "@/components/Nav";
import BrandLogo from "@/components/BrandLogo";
import { API_BASE_URL } from "@/lib/api";

const serverDatabaseOnly =
  typeof process !== "undefined" &&
  ["1", "true", "yes"].includes(
    String(process.env.NEXT_PUBLIC_SERVER_DATABASE_ONLY || "")
      .trim()
      .toLowerCase()
  );

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
                  margin: "4px 0",
                  padding: 0,
                  lineHeight: 0,
                  fontSize: 0,
                  fontWeight: "inherit",
                }}
              >
                <BrandLogo height={88} maxWidth={480} />
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
              <div style={{ fontSize: 24, fontWeight: 900 }}>BudFox Supply</div>
              <div style={{ color: "#64748b", marginTop: 4 }}>
                Multi-user backend ready
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
              API base URL:{" "}
              <span style={{ color: "#86efac", fontWeight: 800 }}>
                {API_BASE_URL}
              </span>
              . Production batches, extraction runs, packaging lots, source
              material, cultivation rows, and task logs are written through this
              API into the company PostgreSQL database (not the in-browser store).
            </p>
          </div>

          <div style={infoPanelStyle}>
            <h3 style={panelTitleStyle}>Persistence Mode</h3>
            <p style={panelTextStyle}>
              {serverDatabaseOnly ? (
                <>
                  <strong style={{ color: "#86efac" }}>Server database only</strong>{" "}
                  is enabled: the app does not push a full JSON snapshot to{" "}
                  <code style={{ color: "#e2e8f0" }}>/api/store</code>. Set{" "}
                  <code style={{ color: "#e2e8f0" }}>
                    NEXT_PUBLIC_SERVER_DATABASE_ONLY=false
                  </code>{" "}
                  locally if you still want the legacy company-store backup sync.
                </>
              ) : (
                <>
                  Entity pages save to PostgreSQL via the API. The app may still
                  call{" "}
                  <code style={{ color: "#e2e8f0" }}>PUT /api/store</code> as a
                  backup. For hosted production, set{" "}
                  <code style={{ color: "#e2e8f0" }}>
                    NEXT_PUBLIC_SERVER_DATABASE_ONLY=true
                  </code>{" "}
                  on Vercel so only the database receives writes.
                </>
              )}
            </p>
          </div>

          <div style={infoPanelStyle}>
            <h3 style={panelTitleStyle}>Login Enabled</h3>
            <p style={panelTextStyle}>
              Company login ties each user to a company, role, and permission
              level. All scoped reads and writes go to the API with your session
              and tenant headers.
            </p>
          </div>

          <div style={infoPanelStyle}>
            <h3 style={panelTitleStyle}>Data Hub</h3>
            <p style={panelTextStyle}>
              Cultivation, Extraction, Packaging, and Data Hub all load from the
              same API-backed records so every user sees the same live company
              state (with a small legacy hydrate from GET /api/store where a
              slice is not yet in Prisma).
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