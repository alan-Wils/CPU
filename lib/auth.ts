export type CpuUser = {
  id: string;
  username: string;
  email?: string | null;
  role: string;
};

export type CpuCompany = {
  id: string;
  name: string;
  code: string;
};

export type LoginResponse = {
  token: string;
  user: CpuUser;
  company: CpuCompany;
};

const TOKEN_KEY = "cpu_auth_token";
const USER_KEY = "cpu_auth_user";
const COMPANY_KEY = "cpu_auth_company";

export function saveAuthSession(data: LoginResponse) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(TOKEN_KEY, data.token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(data.user));
  window.localStorage.setItem(COMPANY_KEY, JSON.stringify(data.company));
}

export function getAuthToken() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(TOKEN_KEY) || "";
}

export function getAuthUser(): CpuUser | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Display handle for logs and UI when `username` is missing (older `@cpu/api` login payloads). */
export function displayNameFromAuthUser(user: CpuUser | null): string {
  if (!user) return "Unknown User";
  const fromUsername = String(user.username || "").trim();
  if (fromUsername && fromUsername !== "Unknown User") return fromUsername;
  const email = String(user.email || "").trim();
  if (email) {
    const i = email.indexOf("@");
    return i > 0 ? email.slice(0, i) : email;
  }
  return "Unknown User";
}

export function getAuthDisplayName(): string {
  return displayNameFromAuthUser(getAuthUser());
}

/** For `loggedBy` objects on task logs (handles legacy "Unknown User" + `email` if present). */
export function displayNameFromLogActor(actor: unknown): string {
  if (!actor || typeof actor !== "object") return "Unknown User";
  const o = actor as { username?: unknown; email?: unknown };
  const u = String(o.username || "").trim();
  if (u && u !== "Unknown User") return u;
  const e = String(o.email || "").trim();
  if (e) {
    const i = e.indexOf("@");
    return i > 0 ? e.slice(0, i) : e;
  }
  return "Unknown User";
}

export function getAuthCompany(): CpuCompany | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(COMPANY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function isLoggedIn() {
  return Boolean(getAuthToken());
}

/** Legacy keys written by older login code — clear so stale tokens cannot confuse other code paths. */
const LEGACY_AUTH_KEYS = [
  "token",
  "authToken",
  "cannabis_cpu_token",
  "user",
  "authUser",
  "cannabis_cpu_user",
  "company",
  "authCompany",
  "cannabis_cpu_company",
];

export function clearAuthSession() {
  if (typeof window === "undefined") return;

  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
  window.localStorage.removeItem(COMPANY_KEY);
  for (const k of LEGACY_AUTH_KEYS) {
    window.localStorage.removeItem(k);
  }
}