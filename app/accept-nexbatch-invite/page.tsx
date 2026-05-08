"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import TopBrandStrip from "@/components/TopBrandStrip";
import { acceptNexBatchInvite, API_BASE_URL } from "@/lib/api";
import { saveAuthSession } from "@/lib/auth";

function AcceptNexBatchInviteInner() {
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
      setError("Invite token is missing.");
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
      const data = await acceptNexBatchInvite({
        token,
        password,
      });
      saveAuthSession(data);
      if (data.needsCompanySelection) {
        router.push("/portal");
      } else {
        router.push("/");
      }
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Could not accept NexBatch invite.",
      );
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
        <h1 style={{ marginTop: 0, fontSize: 30 }}>NexBatch staff invite</h1>

        <p style={{ color: "#94a3b8", marginBottom: 12 }}>
          Set your password to finish activating your NexBatch portal account.
        </p>

        <p
          style={{
            margin: "0 0 18px",
            padding: "14px 16px",
            borderRadius: 12,
            border: "1px solid rgba(56, 189, 248, 0.35)",
            background: "rgba(14, 116, 144, 0.18)",
            color: "#bae6fd",
            fontSize: 15,
            lineHeight: 1.55,
          }}
        >
          After activation, open the <strong style={{ color: "#f0f9ff" }}>NexBatch portal</strong> and sign in with your{" "}
          <strong style={{ color: "#f0f9ff" }}>email</strong> and this{" "}
          <strong style={{ color: "#f0f9ff" }}>same password</strong>.
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
            marginTop: 8,
          }}
        >
          {saving ? "Saving…" : "Activate account"}
        </button>
      </form>
      </div>
    </main>
  );
}

export default function AcceptNexBatchInvitePage() {
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
      <AcceptNexBatchInviteInner />
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
