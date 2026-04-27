/**
 * Public API base URLs (NEXT_PUBLIC_* are inlined at build time on Vercel).
 * Localhost defaults apply only in development; production requires env to be set in Vercel.
 */
const isDev = process.env.NODE_ENV === "development";

export const publicApiBaseUrl: string =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? (isDev ? "http://localhost:4000/api" : "");

export const publicApiOriginUrl: string =
  process.env.NEXT_PUBLIC_API_URL ?? (isDev ? "http://localhost:4000" : "");
