"use client";

import { useEffect, useState } from "react";
import { loginCompany } from "@/lib/api";
import { saveAuthSession } from "@/lib/auth";
import { loadBackendStore } from "@/lib/backendStore";

const SAVED_LOGIN_KEY = "cannabis_cpu_saved_login";

export default function LoginPage() {
  const [companyCode, setCompanyCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [rememberLogin, setRememberLogin] = useState(false);
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
        setRememberLogin(true);
      } catch {
        localStorage.removeItem(SAVED_LOGIN_KEY);
      }
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

    try {
      const data = await loginCompany({
        companyCode: cleanedCompanyCode,
        username: cleanedUsername,
        password,
      });

      if (rememberLogin) {
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

      await loadBackendStore();

      window.location.href = data.user?.role === "OWNER" ? "/admin" : "/";
    } catch (err: any) {
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
    setRememberLogin(false);
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
          <h1 style={{ fontSize: 42, fontWeight: 900, marginBottom: 12 }}>
            Cannabis CPU
          </h1>

          <p style={{ color: "#93c5fd", margin: 0, fontSize: 20 }}>
            Sign in to your workspace
          </p>

          <p style={{ color: "#64748b", marginTop: 10, fontSize: 14 }}>
            Platform owners can leave Company Code blank.
          </p>
        </div>

        <label style={{ display: "block", marginBottom: 18 }}>
          <div style={labelStyle}>Company Code Optional for Owner</div>
          <input
            value={companyCode}
            onChange={(e) => setCompanyCode(e.target.value)}
            style={inputStyle}
            placeholder="Enter company code or leave blank as owner"
            autoComplete="organization"
          />
        </label>

        <label style={{ display: "block", marginBottom: 18 }}>
          <div style={labelStyle}>Username</div>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={inputStyle}
            placeholder="Enter username"
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
              fontSize: 20,
            }}
          >
            <input
              type="checkbox"
              checked={rememberLogin}
              onChange={(e) => setRememberLogin(e.target.checked)}
              style={{
                width: 18,
                height: 18,
                accentColor: "#22c55e",
              }}
            />
            Save login
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
            Clear
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
          Saved login stores only optional company code and username on this device.
        </div>
      </form>
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
