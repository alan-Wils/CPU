"use client";

import { useEffect, useState } from "react";
import {
  API_BASE_URL,
  clearSelectedCompanyId,
  loginCompany,
  setSelectedCompanyId,
} from "@/lib/api";
import { clearAuthSession, saveAuthSession } from "@/lib/auth";
import { loadBackendStore } from "@/lib/backendStore";
import TopBrandStrip from "@/components/TopBrandStrip";

const SAVED_LOGIN_KEY = "cannabis_cpu_saved_login";
/** Persists preference for longer JWT (`remember` on `/api/auth/login`). */
const STAY_SIGNED_IN_KEY = "cpu_stay_signed_in_pref";

function resolvePostLoginHref(role: string): string {
  if (typeof window === "undefined") {
    return "/";
  }
  const next = new URLSearchParams(window.location.search).get("next");
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    return next;
  }
  return role === "OWNER" ? "/admin" : "/";
}

export default function LoginPage() {
  const [companyCode, setCompanyCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [rememberUsername, setRememberUsername] = useState(false);
  const [staySignedIn, setStaySignedIn] = useState(true);
  const [capsLockOn, setCapsLockOn] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem(SAVED_LOGIN_KEY);

    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setCompanyCode(parsed.companyCode || "");
        setUsername(parsed.username || "");
        setRememberUsername(true);
      } catch {
        localStorage.removeItem(SAVED_LOGIN_KEY);
      }
    }

    const stayPref = localStorage.getItem(STAY_SIGNED_IN_KEY);
    if (stayPref === "0" || stayPref === "false") {
      setStaySignedIn(false);
    } else {
      setStaySignedIn(true);
    }
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const cleanedCompanyCode = companyCode.trim();
    const cleanedUsername = username.trim();

    if (!cleanedUsername) {
      setError("Username is required");
      return;
    }

    if (!password) {
      setError("Password is required");
      return;
    }

    setLoading(true);

    let sessionWritten = false;

    try {
      const data = await loginCompany({
        companyCode: cleanedCompanyCode,
        username: cleanedUsername,
        password,
        remember: staySignedIn,
      });

      localStorage.setItem(STAY_SIGNED_IN_KEY, staySignedIn ? "1" : "0");

      if (rememberUsername) {
        localStorage.setItem(
          SAVED_LOGIN_KEY,
          JSON.stringify({
            companyCode: cleanedCompanyCode,
            username: cleanedUsername,
          })
        );
      } else {
        localStorage.removeItem(SAVED_LOGIN_KEY);
      }

      saveAuthSession(data);
      sessionWritten = true;

      if ((data as { needsCompanySelection?: boolean }).needsCompanySelection) {
        clearSelectedCompanyId();
        window.location.href = "/portal";
        return;
      }

      localStorage.setItem("token", data.token || "");
      localStorage.setItem("authToken", data.token || "");
      localStorage.setItem("cannabis_cpu_token", data.token || "");

      localStorage.setItem("user", JSON.stringify(data.user || null));
      localStorage.setItem("authUser", JSON.stringify(data.user || null));
      localStorage.setItem("cannabis_cpu_user", JSON.stringify(data.user || null));

      localStorage.setItem("company", JSON.stringify(data.company || null));
      localStorage.setItem("authCompany", JSON.stringify(data.company || null));
      localStorage.setItem(
        "cannabis_cpu_company",
        JSON.stringify(data.company || null)
      );

      setSelectedCompanyId(data.company?.id || "");

      await loadBackendStore();

      window.location.href = resolvePostLoginHref(String(data.user?.role || ""));
    } catch (err: any) {
      if (sessionWritten) {
        clearAuthSession();
        clearSelectedCompanyId();
        localStorage.removeItem("token");
        localStorage.removeItem("authToken");
        localStorage.removeItem("cannabis_cpu_token");
        localStorage.removeItem("user");
        localStorage.removeItem("authUser");
        localStorage.removeItem("cannabis_cpu_user");
        localStorage.removeItem("company");
        localStorage.removeItem("authCompany");
        localStorage.removeItem("cannabis_cpu_company");
        setSelectedCompanyId("");
      }
      setError(err?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  function clearSavedLogin() {
    localStorage.removeItem(SAVED_LOGIN_KEY);
    setCompanyCode("");
    setUsername("");
    setPassword("");
    setRememberUsername(false);
    setError("");
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
      <div
        style={{
          padding: "16px 24px",
          boxSizing: "border-box",
        }}
      >
        <TopBrandStrip apiBaseUrl={API_BASE_URL} linkNexbatchToHome={false} nexbatchHeight={78} />
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
        onSubmit={handleLogin}
        style={{
          width: "100%",
          maxWidth: 560,
          background: "rgba(15, 23, 42, 0.92)",
          border: "1px solid rgba(148, 163, 184, 0.25)",
          borderRadius: 18,
          padding: 44,
          boxShadow: "0 30px 80px rgba(0,0,0,0.45)",
          boxSizing: "border-box",
        }}
      >
        <div style={{ marginBottom: 28, textAlign: "center" }}>
          <p style={{ color: "#93c5fd", margin: 0, fontSize: 22, fontWeight: 800 }}>
            Sign in to your workspace
          </p>

          <p style={{ color: "#64748b", marginTop: 10, fontSize: 14 }}>
            Company sign-in: enter company code (e.g. BUDFOX). NexBatch portal
            accounts: leave code blank and use your full NexBatch email.
          </p>
        </div>

        <label style={{ display: "block", marginBottom: 18 }}>
          <div style={labelStyle}>Company code (required for company users)</div>
          <input
            value={companyCode}
            onChange={(e) => setCompanyCode(e.target.value)}
            style={inputStyle}
            placeholder="e.g. CODE — leave blank only for NexBatch portal login"
            autoComplete="organization"
          />
        </label>

        <label style={{ display: "block", marginBottom: 18 }}>
          <div style={labelStyle}>Username</div>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={inputStyle}
            placeholder="Username or email"
            autoComplete="username"
          />
        </label>

        <label style={{ display: "block", marginBottom: 12 }}>
          <div style={labelStyle}>Password</div>

          <div style={{ position: "relative", width: "100%", boxSizing: "border-box" }}>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyUp={(e) => setCapsLockOn(e.getModifierState("CapsLock"))}
              onKeyDown={(e) => setCapsLockOn(e.getModifierState("CapsLock"))}
              type={showPassword ? "text" : "password"}
              style={{ ...inputStyle, paddingRight: 105 }}
              placeholder="Enter password"
              autoComplete="current-password"
            />

            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowPassword((prev) => !prev)}
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                border: "1px solid rgba(148, 163, 184, 0.3)",
                background: "rgba(30, 41, 59, 0.95)",
                color: "#dbeafe",
                borderRadius: 10,
                padding: "10px 14px",
                fontWeight: 900,
                cursor: "pointer",
                zIndex: 2,
              }}
            >
              {showPassword ? "Hide" : "View"}
            </button>
          </div>
        </label>

        <div style={{ marginBottom: 14, textAlign: "right" }}>
          <a
            href="/forgot-password"
            style={{ color: "#38bdf8", fontWeight: 800, fontSize: 14, textDecoration: "none" }}
          >
            Forgot password?
          </a>
        </div>

        {capsLockOn && (
          <div
            style={{
              color: "#fde68a",
              fontSize: 13,
              fontWeight: 800,
              marginBottom: 12,
            }}
          >
            Caps Lock is on
          </div>
        )}

        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            color: "#dbeafe",
            fontWeight: 800,
            cursor: "pointer",
            fontSize: 16,
            marginBottom: 14,
            lineHeight: 1.45,
          }}
        >
          <input
            type="checkbox"
            checked={staySignedIn}
            onChange={(e) => setStaySignedIn(e.target.checked)}
            style={{
              width: 18,
              height: 18,
              marginTop: 3,
              accentColor: "#22c55e",
              flexShrink: 0,
            }}
          />
          <span>
            Stay signed in for 7 days (recommended). If unchecked, the session
            expires sooner per server policy (often within a few hours).
          </span>
        </label>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              color: "#dbeafe",
              fontWeight: 900,
              cursor: "pointer",
              fontSize: 18,
            }}
          >
            <input
              type="checkbox"
              checked={rememberUsername}
              onChange={(e) => setRememberUsername(e.target.checked)}
              style={{
                width: 18,
                height: 18,
                accentColor: "#22c55e",
              }}
            />
            Remember username on this device
          </label>

          <button
            type="button"
            onClick={clearSavedLogin}
            style={{
              border: "none",
              background: "transparent",
              color: "#93c5fd",
              fontWeight: 900,
              cursor: "pointer",
              fontSize: 15,
            }}
          >
            Clear saved username
          </button>
        </div>

        {error && (
          <div
            style={{
              background: "rgba(127, 29, 29, 0.55)",
              border: "1px solid rgba(248, 113, 113, 0.45)",
              color: "#fecaca",
              borderRadius: 12,
              padding: 12,
              marginBottom: 16,
              fontWeight: 700,
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            border: "none",
            borderRadius: 12,
            padding: "16px 18px",
            background: loading ? "#475569" : "#22c55e",
            color: "#052e16",
            fontWeight: 950,
            fontSize: 20,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Signing In & Loading Data..." : "Sign In"}
        </button>

        <div
          style={{
            marginTop: 24,
            color: "#64748b",
            fontSize: 16,
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          “Stay signed in” requests a longer API token. “Remember username” only
          saves company code and username in this browser (not your password).
        </div>
      </form>
      </div>
    </main>
  );
}

const labelStyle: React.CSSProperties = {
  marginBottom: 8,
  color: "#dbeafe",
  fontWeight: 900,
  fontSize: 20,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid rgba(148, 163, 184, 0.3)",
  background: "#020617",
  color: "white",
  borderRadius: 12,
  padding: "16px 18px",
  outline: "none",
  fontSize: 18,
};