"use client";

import Link from "next/link";
import { useState } from "react";
import TopBrandStrip from "@/components/TopBrandStrip";
import { API_BASE_URL, requestPasswordResetEmail } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const clean = email.trim().toLowerCase();
    if (!clean || !clean.includes("@")) {
      setError("Enter the email address on your account.");
      return;
    }
    setLoading(true);
    try {
      await requestPasswordResetEmail(clean);
      setSubmitted(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top, #1e293b 0, #020617 45%, #000 100%)",
        color: "white",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
      }}
    >
      <div style={{ padding: "16px 24px", boxSizing: "border-box" }}>
        <TopBrandStrip apiBaseUrl={API_BASE_URL} linkNexbatchToHome={false} />
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
      <form
        onSubmit={submit}
        style={{
          width: "100%",
          maxWidth: 520,
          background: "rgba(15, 23, 42, 0.92)",
          border: "1px solid rgba(148, 163, 184, 0.25)",
          borderRadius: 18,
          padding: 40,
          boxSizing: "border-box",
        }}
      >
        <div style={{ marginBottom: 24, textAlign: "center" }}>
          <p style={{ color: "#93c5fd", margin: 0, fontSize: 18, fontWeight: 800 }}>
            Forgot password
          </p>
        </div>

        {submitted ? (
          <p style={{ color: "#94a3b8", lineHeight: 1.55, margin: 0 }}>
            If an account exists for that email, we sent a reset link. Check your inbox and spam folder.
          </p>
        ) : (
          <>
            <p style={{ color: "#94a3b8", lineHeight: 1.55, marginTop: 0 }}>
              Enter your account email. We will send a link to set a new password.
            </p>

            {error && (
              <div
                style={{
                  background: "#7f1d1d",
                  border: "1px solid #ef4444",
                  color: "#fecaca",
                  borderRadius: 12,
                  padding: 12,
                  marginBottom: 16,
                  fontWeight: 800,
                }}
              >
                {error}
              </div>
            )}

            <label style={{ display: "block", marginBottom: 22 }}>
              <div style={{ color: "#cbd5e1", fontWeight: 800, marginBottom: 8 }}>Email</div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  width: "100%",
                  border: "1px solid rgba(148, 163, 184, 0.35)",
                  background: "rgba(2, 6, 23, 0.85)",
                  color: "white",
                  borderRadius: 12,
                  padding: "12px 14px",
                  fontSize: 16,
                  outline: "none",
                  boxSizing: "border-box",
                }}
                autoComplete="email"
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                border: "none",
                borderRadius: 12,
                padding: "14px 16px",
                background: loading ? "#475569" : "#22c55e",
                color: "white",
                fontWeight: 900,
                fontSize: 16,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Sending…" : "Send reset link"}
            </button>
          </>
        )}

        <p style={{ marginTop: 24, marginBottom: 0, textAlign: "center" }}>
          <Link href="/login" style={{ color: "#38bdf8", fontWeight: 800 }}>
            Back to sign in
          </Link>
        </p>
      </form>
      </div>
    </main>
  );
}
