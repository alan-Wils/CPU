"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type SessionUser = {
  id: string;
  role: string;
  companyId: string;
  companyCode: string;
  username?: string;
};

type AuthState = {
  token: string | null;
  user: SessionUser | null;
  hydrated: boolean;
  setSession: (token: string, user: SessionUser, remember?: boolean) => void;
  clearSession: () => void;
};

const KEY = "cpu_auth_session_v1";
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { token: string; user: SessionUser; remember: boolean };
        setToken(parsed.token);
        setUser(parsed.user);
      }
    } finally {
      setHydrated(true);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      token,
      user,
      hydrated,
      setSession(nextToken, nextUser, remember = true) {
        setToken(nextToken);
        setUser(nextUser);
        localStorage.setItem("token", nextToken);
        localStorage.setItem("user", JSON.stringify(nextUser));
        if (remember) {
          localStorage.setItem(KEY, JSON.stringify({ token: nextToken, user: nextUser, remember }));
          sessionStorage.removeItem("token");
          sessionStorage.removeItem("user");
        } else {
          sessionStorage.setItem(KEY, JSON.stringify({ token: nextToken, user: nextUser, remember }));
          sessionStorage.setItem("token", nextToken);
          sessionStorage.setItem("user", JSON.stringify(nextUser));
          localStorage.removeItem(KEY);
        }
      },
      clearSession() {
        setToken(null);
        setUser(null);
        localStorage.removeItem(KEY);
        sessionStorage.removeItem(KEY);
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        sessionStorage.removeItem("token");
        sessionStorage.removeItem("user");
      }
    }),
    [token, user, hydrated]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used under AuthProvider");
  }
  return ctx;
}

export function getAuthUser(): SessionUser | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { user?: SessionUser };
    return parsed.user ?? null;
  } catch {
    return null;
  }
}

export function getAuthCompany(): { id?: string; code?: string; name?: string } | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = localStorage.getItem("company") ?? localStorage.getItem("authCompany");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveAuthSession(data: { token?: string; user?: SessionUser; company?: any }) {
  const token = data.token || "";
  const user = (data.user || null) as SessionUser | null;
  localStorage.setItem("token", token);
  localStorage.setItem("authToken", token);
  if (user) {
    localStorage.setItem("user", JSON.stringify(user));
    localStorage.setItem("authUser", JSON.stringify(user));
    localStorage.setItem(KEY, JSON.stringify({ token, user, remember: true }));
  }
  if (data.company !== undefined) {
    localStorage.setItem("company", JSON.stringify(data.company));
    localStorage.setItem("authCompany", JSON.stringify(data.company));
  }
}

export function clearAuthSession() {
  localStorage.removeItem("token");
  localStorage.removeItem("authToken");
  localStorage.removeItem("user");
  localStorage.removeItem("authUser");
  localStorage.removeItem("company");
  localStorage.removeItem("authCompany");
  localStorage.removeItem(KEY);
  sessionStorage.removeItem(KEY);
  sessionStorage.removeItem("token");
  sessionStorage.removeItem("user");
}

export function isLoggedIn() {
  if (typeof window === "undefined") return false;
  return Boolean(localStorage.getItem("token") || sessionStorage.getItem("token"));
}
