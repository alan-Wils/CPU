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

export function clearAuthSession() {
  if (typeof window === "undefined") return;

  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
  window.localStorage.removeItem(COMPANY_KEY);
}