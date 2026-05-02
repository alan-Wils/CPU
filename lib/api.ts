import { getAuthToken } from "./auth";

function resolveApiBaseUrl(): string {
  const fromEnv =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_API_URL?.trim()
      : "";
  if (fromEnv)
    return fromEnv.replace(/\/+$/, "");
  return "http://localhost:4000";
}

/** Railway / local `@cpu/api` origin; set `NEXT_PUBLIC_API_URL` on Vercel (no trailing slash). */
export const API_BASE_URL = resolveApiBaseUrl();

const SELECTED_COMPANY_KEY = "cpu_selected_company_id";

type ApiOptions = {
  method?: string;
  body?: any;
  auth?: boolean;
  companyId?: string;
};

export function getSelectedCompanyId() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(SELECTED_COMPANY_KEY) || "";
}

export function setSelectedCompanyId(companyId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SELECTED_COMPANY_KEY, companyId);
}

export function clearSelectedCompanyId() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SELECTED_COMPANY_KEY);
}

const API_FAIL_FALLBACK = "API request failed";

function coerceUnknownToMessage(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => coerceUnknownToMessage(item))
      .filter(Boolean) as string[];
    return parts.length ? parts.join("; ") : null;
  }
  if (typeof value === "object") {
    const m = (value as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  return null;
}

function formatErrorsArray(entries: unknown[]): string | null {
  const parts: string[] = [];
  for (const item of entries) {
    if (typeof item === "string") {
      if (item.trim()) parts.push(item.trim());
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const picked =
      (typeof row.msg === "string" && row.msg.trim()) ||
      (typeof row.message === "string" && row.message.trim()) ||
      (typeof row.path === "string" && row.path.trim()
        ? `${row.path}: ${typeof row.msg === "string" ? row.msg : row.code || "invalid"}`
        : "");
    if (picked) parts.push(picked.trim());
    else {
      const nested = coerceUnknownToMessage(row);
      if (nested) parts.push(nested);
    }
  }
  return parts.length ? parts.join("; ") : null;
}

/** Readable message for failed HTTP responses (avoids `[object Object]` from Error ctor). */
function stringifyApiFailureBody(data: unknown): string {
  if (typeof data === "string") {
    const t = data.trim();
    return t || API_FAIL_FALLBACK;
  }
  if (!data || typeof data !== "object") return API_FAIL_FALLBACK;

  const obj = data as Record<string, unknown>;

  let primary: string | null = null;
  for (const key of ["error", "message", "details"] as const) {
    const s = coerceUnknownToMessage(obj[key]);
    if (s) {
      primary = s;
      break;
    }
  }

  const fromErrors =
    Array.isArray(obj.errors) ? formatErrorsArray(obj.errors as unknown[]) : null;

  const nestedErr = obj.error;
  let fromNestedDetails: string | null = null;
  if (
    nestedErr &&
    typeof nestedErr === "object" &&
    !Array.isArray(nestedErr) &&
    primary &&
    /^validation failed$/i.test(String(primary).trim())
  ) {
    const d = (nestedErr as { details?: unknown }).details;
    if (Array.isArray(d) && d.length) {
      fromNestedDetails = formatErrorsArray(d as unknown[]);
    }
  }

  if (fromErrors && primary && /^validation failed$/i.test(primary.trim())) {
    return `${primary}: ${fromErrors}`;
  }
  if (fromNestedDetails) {
    return `${primary}: ${fromNestedDetails}`;
  }
  if (primary) return primary;
  if (fromErrors) return fromErrors;

  try {
    const json = JSON.stringify(data);
    if (json && json !== "{}") return json;
  } catch {
    /* ignore */
  }

  return API_FAIL_FALLBACK;
}

export async function apiRequest<T = any>(
  path: string,
  options: ApiOptions = {}
): Promise<T> {
  const token = getAuthToken();
  const selectedCompanyId = options.companyId || getSelectedCompanyId();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options.auth !== false && token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (selectedCompanyId) {
    headers["X-Company-Id"] = selectedCompanyId;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();

  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    throw new Error(stringifyApiFailureBody(data));
  }

  return data;
}

export async function loginCompany(payload: {
  companyCode?: string;
  username: string;
  password: string;
}) {
  return apiRequest("/api/auth/login", {
    method: "POST",
    auth: false,
    body: payload,
  });
}

export async function acceptInvite(payload: {
  token: string;
  password: string;
}) {
  return apiRequest("/api/auth/accept-invite", {
    method: "POST",
    auth: false,
    body: payload,
  });
}

export async function changePassword(payload: {
  currentPassword?: string;
  newPassword: string;
}) {
  return apiRequest("/api/auth/change-password", {
    method: "POST",
    body: payload,
  });
}

export async function getMe() {
  return apiRequest("/api/auth/me");
}

export async function getUsers(companyId?: string) {
  return apiRequest("/api/admin/users", {
    companyId,
  });
}

export async function inviteUser(payload: {
  username?: string;
  email: string;
  role: string;
  companyId?: string;
}) {
  return apiRequest("/api/admin/invites", {
    method: "POST",
    body: { email: payload.email.trim().toLowerCase(), role: payload.role },
    companyId: payload.companyId,
  });
}

export async function createUser(payload: {
  username?: string;
  email: string;
  password?: string;
  role: string;
  companyId?: string;
}) {
  return inviteUser({
    username: payload.username,
    email: payload.email,
    role: payload.role,
    companyId: payload.companyId,
  });
}

export async function getCompanies() {
  const raw = await apiRequest<
    { companies: Array<{ code?: string; slug?: string; [k: string]: unknown }> }
  >("/api/companies/all");
  const list = raw.companies ?? [];
  return list.map((c) => ({
    ...c,
    code: c.code || String(c.slug ?? "").toUpperCase(),
  }));
}

export async function getCompanyData<T = any[]>(
  type: string,
  companyId?: string
): Promise<T> {
  return apiRequest(`/api/data/${type}`, {
    companyId,
  });
}

export async function saveCompanyItem<T = any>(
  type: string,
  item: any,
  companyId?: string
): Promise<T> {
  return apiRequest(`/api/data/${type}`, {
    method: "POST",
    body: item,
    companyId,
  });
}

export async function deleteCompanyItem(
  type: string,
  id: string,
  companyId?: string
) {
  return apiRequest(`/api/data/${type}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    companyId,
  });
}

export async function getLogs(companyId?: string) {
  return apiRequest("/api/logs", {
    companyId,
  });
}

export async function saveLog(
  log: {
    area: string;
    batch?: string;
    task: string;
    output?: string;
    data?: any;
  },
  companyId?: string
) {
  return apiRequest("/api/logs", {
    method: "POST",
    body: log,
    companyId,
  });
}