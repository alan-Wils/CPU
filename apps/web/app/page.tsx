import Link from "next/link";

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        margin: 0,
        boxSizing: "border-box",
        background:
          "radial-gradient(circle at top left, rgba(34,197,94,0.15), transparent 32%), radial-gradient(circle at top right, rgba(56,189,248,0.12), transparent 36%), #020617",
        color: "#e2e8f0",
        padding: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 520,
          width: "100%",
          background: "rgba(15, 23, 42, 0.85)",
          border: "1px solid rgba(148, 163, 184, 0.22)",
          borderRadius: 20,
          padding: "36px 32px",
          boxShadow: "0 24px 70px rgba(0,0,0,0.4)",
        }}
      >
        <p
          style={{
            fontSize: 12,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "#22d3ee",
            margin: "0 0 12px",
          }}
        >
          Cannabis CPU
        </p>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 12px", color: "#f8fafc" }}>
          Nexbatch workspace
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.55, color: "#94a3b8", margin: "0 0 28px" }}>
          Capture checks, run OCR, and sync structured fields to your company. Open the check
          capture tool to get started.
        </p>
        <Link
          href="/check-capture"
          style={{
            display: "inline-block",
            background: "linear-gradient(135deg, #22c55e, #14b8a6)",
            color: "#020617",
            fontWeight: 600,
            fontSize: 15,
            padding: "12px 22px",
            borderRadius: 10,
            textDecoration: "none",
            boxShadow: "0 8px 24px rgba(34,197,94,0.25)",
          }}
        >
          Go to check capture
        </Link>
      </div>
    </main>
  );
}
