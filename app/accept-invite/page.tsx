"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import BrandLogo from "@/components/BrandLogo";
import { acceptInvite, getInvitePreview } from "@/lib/api";
import { saveAuthSession } from "@/lib/auth";

function AcceptInvitePageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const token = searchParams.get("token") || "";
  const companyCodeFromUrl = (searchParams.get("companyCode") || "").trim();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [resolvedCompanyCode, setResolvedCompanyCode] = useState("");

  useEffect(() => {
    if (companyCodeFromUrl || !token || token.length < 16) {
      return;
    }
    let cancelled = false;
    void getInvitePreview(token)
      .then((out) => {
        if (!cancelled && out?.companyCode) {
          setResolvedCompanyCode(String(out.companyCode).trim());
        }
      })
      .catch(() => {
        /* old/invalid token — keep generic sign-in hint */
      });
    return () => {
      cancelled = true;
    };
  }, [companyCodeFromUrl, token]);

  const displayCompanyCode = (
    companyCodeFromUrl ||
    resolvedCompanyCode ||
    ""
  ).toUpperCase();

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
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 28,
        padding: 24,
      }}
    >
      <BrandLogo height={120} maxWidth={560} />
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

        <p style={{ color: "#94a3b8", marginBottom: 12 }}>
          Create your password to finish setting up your account.
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
          When you return to the login page, sign in with{" "}
          {displayCompanyCode ? (
            <>
              company code{" "}
              <strong style={{ color: "#f0f9ff" }}>{displayCompanyCode}</strong>, your{" "}
            </>
          ) : (
            <>your company code, </>
          )}
          <strong style={{ color: "#f0f9ff" }}>email</strong>, and{" "}
          <strong style={{ color: "#f0f9ff" }}>this new password</strong>{" "}
          (enter the same password in both fields below, then use it on the login screen).
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

export default function AcceptInvitePage() {
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
      <AcceptInvitePageInner />
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