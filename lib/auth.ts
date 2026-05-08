export type CpuUser = {
  id: string;
  username: string;
  email?: string | null;
  role: string;
  /** App permission ids from JWT (`page.*`, `workflow.delete`). */
  permissions?: string[];
  sessionKind?: "company" | "portal";
  platformRole?: string | null;
  companyId?: string;
  companyCode?: string;
  /** Company membership: enrolled in staff rewards (when returned by API). */
  rewardsEnrolled?: boolean;
};

export type CpuCompany = {
  id: string;
  name: string;
  code: string;
  /** `invited` until the OWNER invite is accepted; `active` when the tenant is live. */
  lifecycleStatus?: "invited" | "active" | string;
};

export type LoginResponse = {
  token: string;
  user: CpuUser;
  company: CpuCompany | null;
  needsCompanySelection?: boolean;
  companies?: CpuCompany[];
};

const TOKEN_KEY = "cpu_auth_token";
/** Exported for listeners (other-tab `storage` events) where role-gated UI must resync. */
export const CPU_AUTH_USER_STORAGE_KEY = "cpu_auth_user";
const USER_KEY = CPU_AUTH_USER_STORAGE_KEY;
const COMPANY_KEY = "cpu_auth_company";
const PORTAL_COMPANIES_KEY = "cpu_portal_companies_json";

/** Fired after `saveAuthSession` so client UI (e.g. home “Current access”) can resync from storage in the same tab. */
export const CPU_AUTH_CHANGED_EVENT = "cpu-auth-changed";

export function saveAuthSession(data: LoginResponse) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(TOKEN_KEY, data.token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(data.user));
  if (data.company) {
    window.localStorage.setItem(COMPANY_KEY, JSON.stringify(data.company));
  } else {
    window.localStorage.removeItem(COMPANY_KEY);
  }
  if (String(data.user?.sessionKind) === "portal" && data.companies?.length) {
    window.localStorage.setItem(
      PORTAL_COMPANIES_KEY,
      JSON.stringify(data.companies)
    );
  } else if (String(data.user?.sessionKind) !== "portal") {
    window.localStorage.removeItem(PORTAL_COMPANIES_KEY);
  }
  window.dispatchEvent(new Event(CPU_AUTH_CHANGED_EVENT));
}

export function setPortalCompanies(companies: CpuCompany[]) {
  if (typeof window === "undefined") return;
  if (companies.length) {
    window.localStorage.setItem(
      PORTAL_COMPANIES_KEY,
      JSON.stringify(companies)
    );
  } else {
    window.localStorage.removeItem(PORTAL_COMPANIES_KEY);
  }
}

export function getPortalCompanies(): CpuCompany[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PORTAL_COMPANIES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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

/** True when signed in as a NexBatch portal operator (may switch allowed companies). */
export function isPortalSession(): boolean {
  const u = getAuthUser();
  return String(u?.sessionKind || "") === "portal";
}

/** NexBatch platform operators may create companies via `POST /api/companies`. */
export function canCreatePlatformCompanies(): boolean {
  const u = getAuthUser();
  const pr = String(u?.platformRole || "").trim();
  return pr === "nexbatch_admin" || pr === "owner";
}

/** Owner, NexBatch Admin, or NexBatch Staff manager — list all companies & manage portal staff invites. */
export function canManageNexBatchPortalStaff(): boolean {
  const u = getAuthUser();
  const pr = String(u?.platformRole || "").trim();
  return pr === "owner" || pr === "nexbatch_admin" || pr === "admin";
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

/** Apply a refreshed JWT (and optional user fields) after `GET /api/auth/me`. */
export function mergeAuthSessionToken(token: string, userPatch?: Partial<CpuUser> | null) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
  if (userPatch && typeof userPatch === "object") {
    const prev = getAuthUser();
    const merged = { ...(prev || {}), ...userPatch } as CpuUser;
    window.localStorage.setItem(USER_KEY, JSON.stringify(merged));
  }
  window.dispatchEvent(new Event(CPU_AUTH_CHANGED_EVENT));
}

export function clearAuthSession() {
  if (typeof window === "undefined") return;

  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
  window.localStorage.removeItem(COMPANY_KEY);
  window.localStorage.removeItem(PORTAL_COMPANIES_KEY);
  for (const k of LEGACY_AUTH_KEYS) {
    window.localStorage.removeItem(k);
  }
  window.dispatchEvent(new Event(CPU_AUTH_CHANGED_EVENT));
}
