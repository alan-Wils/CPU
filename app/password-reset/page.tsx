"use client";

import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Suspense, useState } from "react";
import TopBrandStrip from "@/components/TopBrandStrip";
import { API_BASE_URL, confirmPasswordReset } from "@/lib/api";

function PasswordResetPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!token) {
      setError("Reset link is missing or invalid.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSaving(true);

    try {
      await confirmPasswordReset({ token, password });
      router.push("/login");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not reset password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#020617",
        color: "white",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        padding: 0,
      }}
    >
      <div style={{ padding: "16px 24px", boxSizing: "border-box" }}>
        <TopBrandStrip apiBaseUrl={API_BASE_URL} linkNexbatchToHome={false} nexbatchHeight={44} />
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 28,
          padding: 24,
        }}
      >
      <form
        onSubmit={submit}
        style={{
          width: "100%",
          maxWidth: 460,
          background: "#0f172a",
          border: "1px solid #334155",
          borderRadius: 20,
          padding: 28,
        }}
      >
        <h1 style={{ marginTop: 0, fontSize: 34 }}>Reset password</h1>

        <p style={{ color: "#94a3b8" }}>
          Choose a new password for your account. After saving you will be redirected to sign in.
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

        <label style={labelStyle}>
          New password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
            autoComplete="new-password"
          />
        </label>

        <label style={labelStyle}>
          Confirm password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            style={inputStyle}
            autoComplete="new-password"
          />
        </label>

        <button
          type="submit"
          disabled={saving}
          style={{
            width: "100%",
            border: "none",
            borderRadius: 12,
            padding: "12px 14px",
            background: saving ? "#475569" : "#22c55e",
            color: "white",
            fontWeight: 900,
            fontSize: 16,
            cursor: saving ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Update password"}
        </button>

        <p style={{ marginTop: 18, marginBottom: 0, textAlign: "center" }}>
          <Link href="/login" style={{ color: "#38bdf8", fontWeight: 800 }}>
            Back to sign in
          </Link>
        </p>
      </form>
      </div>
    </main>
  );
}

export default function PasswordResetPage() {
  return (
    <Suspense
      fallback={
        <main
          style={{
            minHeight: "100vh",
            background: "#020617",
            color: "#94a3b8",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          Loading…
        </main>
      }
    >
      <PasswordResetPageInner />
    </Suspense>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  color: "#cbd5e1",
  fontWeight: 800,
  marginBottom: 14,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid #334155",
  background: "#020617",
  color: "white",
  borderRadius: 10,
  padding: "11px 12px",
  outline: "none",
  fontSize: 15,
  marginTop: 6,
  boxSizing: "border-box",
};
