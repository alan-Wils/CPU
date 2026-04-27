"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useState } from "react";
import { acceptInvite } from "@/lib/api";
import { saveAuthSession } from "@/lib/auth";

export default function AcceptInvitePage() {
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

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSaving(true);

    try {
      const data = await acceptInvite({
        token,
        password,
      });

      saveAuthSession(data);
      router.push("/");
    } catch (err: any) {
      setError(err?.message || "Could not accept invite.");
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
        alignItems: "center",
        justifyContent: "center",
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
        <h1 style={{ marginTop: 0, fontSize: 34 }}>Accept Invite</h1>

        <p style={{ color: "#94a3b8" }}>
          Create your password to finish setting up your account.
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
          New Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
        </label>

        <label style={labelStyle}>
          Confirm Password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            style={inputStyle}
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
          {saving ? "Saving..." : "Set Password"}
        </button>
      </form>
    </main>
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
