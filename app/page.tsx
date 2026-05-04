import BrandLogo from "@/components/BrandLogo";
import HomeCurrentAccess from "@/components/HomeCurrentAccess";
import HomeDashboardCards from "@/components/HomeDashboardCards";
import Nav from "@/components/Nav";

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

              <div
                style={{
                  margin: 0,
                  maxWidth: "min(720px, 100%)",
                  width: "100%",
                }}
              >
                <BrandLogo height={160} fitWithinParent linkToHome={false} />
              </div>

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

            <HomeCurrentAccess />
          </div>

          <div style={{ marginTop: 24 }}>
            <Nav />
          </div>
        </header>

        <HomeDashboardCards />
      </div>
    </main>
  );
}