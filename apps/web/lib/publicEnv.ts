/**
 * Public API base URLs (NEXT_PUBLIC_* are inlined at build time on Vercel).
 * Localhost defaults apply only in development; production requires env to be set in Vercel.
 */
const isDev = process.env.NODE_ENV === "development";

export const publicApiBaseUrl: string =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? (isDev ? "http://localhost:4000/api" : "");

export const publicApiOriginUrl: string =
  process.env.NEXT_PUBLIC_API_URL ?? (isDev ? "http://localhost:4000" : "");

function trimTrailingSlash(u: string) {
  return u.replace(/\/+$/, "");
}

function ensureApiSuffix(base: string) {
  const t = trimTrailingSlash(base);
  return t.endsWith("/api") ? t : `${t}/api`;
}

/**
 * Resolves the browser API base at request time so LAN devices (phone, another PC)
 * call the same host as the Next dev server on port 4000, not their own localhost.
 * Prefer NEXT_PUBLIC_API_BASE_URL in production and whenever the API is on a different host.
 */
export function getResolvedApiBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (fromEnv && String(fromEnv).trim().length > 0) {
    return ensureApiSuffix(String(fromEnv).trim());
  }
  if (typeof window === "undefined") {
    return publicApiBaseUrl;
  }
  const { protocol, hostname } = window.location;
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
  if (isLocalhost) {
    return `${protocol}//${hostname}:4000/api`;
  }
  // Same host as the SPA (e.g. http://192.168.1.10:3000 → API at :4000 on that host).
  return `${protocol}//${hostname}:4000/api`;
}

/** Origin only (no /api), for legacy paths like `${origin}/api/config`. */
export function getResolvedApiOriginUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL;
  if (fromEnv && String(fromEnv).trim().length > 0) {
    return trimTrailingSlash(String(fromEnv).trim());
  }
  const base = getResolvedApiBaseUrl();
  return trimTrailingSlash(base.replace(/\/api\/?$/, ""));
}
