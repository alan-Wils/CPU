"use client";

/**
 * Root error boundary — renders when the root layout throws so the user sees a recovery UI
 * instead of an empty browser error page.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui,sans-serif", background: "#020617", color: "#e2e8f0", padding: 24 }}>
        <h1 style={{ fontSize: 20 }}>Something went wrong</h1>
        <p style={{ color: "#94a3b8", maxWidth: 520 }}>
          {error?.message ? String(error.message) : "Please reload or try again."}
        </p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            marginTop: 16,
            padding: "10px 18px",
            borderRadius: 8,
            border: "1px solid rgba(148,163,184,0.35)",
            background: "rgba(34,197,94,0.15)",
            color: "#86efac",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
