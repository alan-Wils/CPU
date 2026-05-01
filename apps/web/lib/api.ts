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

function normalizePath(path: string): string {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  let p = path.startsWith("/") ? path : `/${path}`;
  if (p.startsWith("/api/")) {
    p = p.slice(4);
  } else if (p === "/api") {
    p = "/";
  }
  return p;
}

function headers(token?: string | null, withBody = false): Record<string, string> {
  const base: Record<string, string> = { Accept: "application/json" };
  if (withBody) base["Content-Type"] = "application/json";
  if (token) base.Authorization = `Bearer ${token}`;
  return base;
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = res.statusText || "Request failed";
    let code: string | undefined;
    let details: unknown;
    try {
      const j = (await res.json()) as { message?: string; error?: { message?: string; code?: string } };
      message = j.message || j.error?.message || message;
      code = j.error?.code;
      details = j;
    } catch {
      /* ignore */
    }
    throw new ApiError(message, res.status, code, details);
  }
  return (await res.json()) as T;
}

export async function apiGet<T>(path: string, token?: string | null): Promise<T> {
  const base = apiBase();
  const url = `${base}/api${normalizePath(path)}`;
  const res = await fetch(url, { headers: headers(token) });
  return unwrap<T>(res);
}

export async function apiPost<T>(path: string, body: unknown, token?: string | null): Promise<T> {
  const base = apiBase();
  const url = `${base}/api${normalizePath(path)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: headers(token, true),
    body: JSON.stringify(body)
  });
  return unwrap<T>(res);
}
