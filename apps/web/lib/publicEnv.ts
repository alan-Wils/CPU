/**
 * Resolve browser API base (same origin or explicit NEXT_PUBLIC_API_BASE_URL).
 */
export const publicApiBaseUrl =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE_URL
    ? String(process.env.NEXT_PUBLIC_API_BASE_URL).replace(/\/$/, "")
    : "";

export function getResolvedApiBaseUrl(): string {
  if (typeof window === "undefined") {
    return publicApiBaseUrl || "";
  }
  const fromEnv = publicApiBaseUrl;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return "";
}
