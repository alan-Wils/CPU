import { env } from "./env.js";
import { logWarn } from "../lib/logger.js";

/**
 * Base URL for links in outbound email (invite, etc.).
 * Prefer APP_URL; if missing or not absolute, use first HTTPS entry in CORS_ORIGIN (e.g. Vercel frontend).
 */
export function resolvePublicWebBaseUrl(): string {
  const fromApp =
    typeof env.APP_URL === "string" ? env.APP_URL.trim().replace(/\/+$/, "") : "";
  if (fromApp && /^https?:\/\//i.test(fromApp)) {
    return fromApp;
  }

  const corsRaw = String(env.CORS_ORIGIN ?? "").trim();
  if (corsRaw && corsRaw !== "*") {
    const first = corsRaw
      .split(",")
      .map((s) => s.trim())
      .find((s) => /^https?:\/\//i.test(s));
    if (first) {
      return first.replace(/\/+$/, "");
    }
  }

  if (env.NODE_ENV === "production") {
    logWarn("public_web_base_fallback", {
      hint: "Set APP_URL to your Vercel site (https://...) so invite emails and inviteUrl are absolute URLs.",
      hadAppUrl: Boolean(fromApp),
    });
  }

  return "http://localhost:3000";
}
