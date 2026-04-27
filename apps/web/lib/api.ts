import { getResolvedApiBaseUrl, publicApiBaseUrl } from "./publicEnv";

function apiBase(): string {
  if (typeof window !== "undefined") {
    return getResolvedApiBaseUrl();
  }
  return publicApiBaseUrl;
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getApiErrorMessage(error: unknown, fallback = "Request failed"): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

function generateTempPassword() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const raw = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${raw.slice(0, 10)}Aa!1`;
}

function normalizePath(path: string) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  let p = path.startsWith("/") ? path : `/${path}`;
  if (p.startsWith("/api/")) {
    p = p.slice(4);
  } else if (p === "/api") {
    p = "/";
  }
  return p;
}

function mapLegacyAdminPath(path: string, method: string) {
  const p = normalizePath(path);

  // Legacy admin/users endpoints used by imported pages.
  if (method === "GET" && p === "/users") return "/admin/users";
  if (method === "PATCH" && p.startsWith("/users/")) return `/admin${p}`;
  if (method === "DELETE" && p.startsWith("/users/")) return `/admin${p}`;
  if (method === "POST" && p === "/users") return "/companies/users";
  if (method === "POST" && p === "/users/invite") return "/admin/invites";

  return p;
}

function headers(token?: string | null, withBody = false): Record<string, string> {
  const base: Record<string, string> = { Accept: "application/json" };
  if (withBody) {
    base["Content-Type"] = "application/json";
  }
  if (token) {
    base.Authorization = `Bearer ${token}`;
  }
  return base;
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let text = "";
    let code: string | undefined;
    let details: unknown;
    try {
      const rawText = await res.text();
      text = rawText;
      if (rawText) {
        const parsed = JSON.parse(rawText) as {
          message?: string;
          details?: unknown;
          error?: { code?: string; message?: string; details?: unknown };
        };
        code = parsed.error?.code;
        details = parsed.error?.details ?? parsed.details;
        text = parsed.error?.message || parsed.message || rawText;
      }
    } catch {
      text = res.statusText;
    }
    throw new ApiError(text || res.statusText, res.status, code, details);
  }
  return (await res.json()) as T;
}

export async function apiGet<T>(path: string, token?: string | null): Promise<T> {
  const res = await fetch(`${apiBase()}${normalizePath(path)}`, { cache: "no-store", headers: headers(token) });
  return unwrap<T>(res);
}

export async function apiPost<T>(path: string, body: unknown, token?: string | null): Promise<T> {
  const res = await fetch(`${apiBase()}${normalizePath(path)}`, {
    method: "POST",
    cache: "no-store",
    headers: headers(token, true),
    body: JSON.stringify(body)
  });
  return unwrap<T>(res);
}

export async function apiPut<T>(path: string, body: unknown, token?: string | null): Promise<T> {
  const res = await fetch(`${apiBase()}${normalizePath(path)}`, {
    method: "PUT",
    cache: "no-store",
    headers: headers(token, true),
    body: JSON.stringify(body)
  });
  return unwrap<T>(res);
}

export async function apiDelete<T>(path: string, token?: string | null): Promise<T> {
  const res = await fetch(`${apiBase()}${normalizePath(path)}`, {
    method: "DELETE",
    cache: "no-store",
    headers: headers(token)
  });
  return unwrap<T>(res);
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
    token?: string | null;
    companyId?: string;
  } = {}
): Promise<T> {
  const legacyPath = normalizePath(path);
  const method = options.method ?? "GET";
  const withBody = options.body !== undefined && method !== "GET";
  const mappedPath = mapLegacyAdminPath(path, method);

  if (legacyPath === "/auth/companies" && method === "GET") {
    const response = await apiGet<any>("/companies/all", options.token ?? localStorage.getItem("token"));
    return (Array.isArray(response?.companies) ? response.companies : []) as T;
  }

  if (legacyPath === "/users/invite" && method === "POST") {
    const body = (options.body || {}) as any;
    const invite = await apiPost<any>(
      "/admin/invites",
      { email: body.email, role: body.role },
      options.token ?? localStorage.getItem("token")
    );
    return {
      inviteUrl: invite?.token ? `/accept-invite?token=${invite.token}` : "",
      user: {
        id: invite?.id ?? "",
        username: String(body.email || "").split("@")[0],
        email: body.email,
        role: body.role,
        active: false,
        status: "INVITED"
      }
    } as T;
  }

  let requestBody = options.body;
  if (legacyPath === "/auth/companies" && method === "POST") {
    const body = (options.body || {}) as any;
    requestBody = {
      name: body.name,
      slug: String(body.code || body.slug || "")
        .toLowerCase()
        .trim(),
      ownerEmail: body.ownerEmail,
      ownerPassword: body.ownerPassword || generateTempPassword()
    };
  }

  if (legacyPath === "/users" && method === "POST") {
    const body = (options.body || {}) as any;
    requestBody = {
      email: body.email,
      role: body.role,
      password: body.password || generateTempPassword()
    };
  }

  const query =
    options.companyId && method === "GET"
      ? `${mappedPath.includes("?") ? "&" : "?"}companyId=${encodeURIComponent(options.companyId)}`
      : "";

  const res = await fetch(`${apiBase()}${mappedPath}${query}`, {
    method,
    cache: "no-store",
    headers: headers(options.token ?? localStorage.getItem("token"), withBody),
    body: withBody ? JSON.stringify(requestBody) : undefined
  });
  const data = await unwrap<any>(res);
  if (legacyPath === "/users" && method === "GET") {
    return (Array.isArray(data?.users) ? data.users : Array.isArray(data) ? data : []) as T;
  }
  return data as T;
}

export async function getMe() {
  const token = localStorage.getItem("token");
  const authEnvelope = await apiGet<any>("/auth/me", token);
  const auth = authEnvelope?.auth || {};
  const localUser = (() => {
    try {
      return JSON.parse(localStorage.getItem("user") || localStorage.getItem("authUser") || "null");
    } catch {
      return null;
    }
  })();
  const companyEnvelope = await apiGet<any>("/companies/me", token).catch(() => ({ company: null }));

  return {
    user: {
      id: auth.userId || localUser?.id || "",
      role: auth.role || localUser?.role || "",
      companyId: auth.companyId || localUser?.companyId || "",
      companyCode: localUser?.companyCode || ""
    },
    company: companyEnvelope?.company ?? null
  };
}

export function getSelectedCompanyId() {
  return localStorage.getItem("selectedCompanyId");
}

export function setSelectedCompanyId(companyId: string) {
  localStorage.setItem("selectedCompanyId", companyId);
}

export async function loginCompany(payload: {
  companyCode?: string;
  username: string;
  password: string;
}) {
  const data = await apiPost<any>("/auth/login", {
    email: payload.username,
    password: payload.password,
    companyCode: payload.companyCode || undefined,
    remember: true
  });
  return {
    token: data.token,
    user: data.user,
    company: data.company ?? null
  };
}

export async function acceptInvite(payload: { token: string; password: string }) {
  const data = await apiPost<any>("/auth/accept-invite", payload);
  return {
    token: data.token,
    user: data.user,
    company: data.company ?? null
  };
}

export async function getLogs() {
  const token = localStorage.getItem("token");
  const data = await apiGet<any>("/activity/all", token);
  return data;
}

export { publicApiBaseUrl as API_BASE };
