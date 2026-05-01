import { env } from "./env.js";
import { logWarn } from "../lib/logger.js";

/**
 * If invite links use this Railway hostname, browsers hit the API (Express); there is no GET /accept-invite here.
 */
function warnIfInviteBaseMatchesThisRailwayHost(webBaseUrl: string): void {
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim().toLowerCase();
  if (!railwayDomain || env.NODE_ENV !== "production") return;
  try {
    const host = new URL(webBaseUrl).hostname.toLowerCase();
    if (host !== railwayDomain) return;
    logWarn("invite_web_base_matches_railway_api_host", {
      resolvedBaseUrl: webBaseUrl,
      railwayPublicDomain: railwayDomain,
      fix:
        "Set APP_URL on the API to your Next.js (or other) frontend origin — e.g. https://your-app.vercel.app — not this Railway hostname. Emails link to APP_URL first; alternatively put that frontend URL first in CORS_ORIGIN if APP_URL is unset.",
    });
  } catch {
    /* malformed URL shouldn't reach here if zod enforced APP_URL */
  }
}

/**
 * Base URL for links in outbound email (invite, etc.).
 * Prefer APP_URL; if missing or not absolute, use first HTTPS entry in CORS_ORIGIN (e.g. Vercel frontend).
 */
export function resolvePublicWebBaseUrl(): string {
  const fromApp =
    typeof env.APP_URL === "string" ? env.APP_URL.trim().replace(/\/+$/, "") : "";
  if (fromApp && /^https?:\/\//i.test(fromApp)) {
    warnIfInviteBaseMatchesThisRailwayHost(fromApp);
    return fromApp;
  }

  const corsRaw = String(env.CORS_ORIGIN ?? "").trim();
  if (corsRaw && corsRaw !== "*") {
    const first = corsRaw
      .split(",")
      .map((s) => s.trim())
      .find((s) => /^https?:\/\//i.test(s));
    if (first) {
      const base = first.replace(/\/+$/, "");
      warnIfInviteBaseMatchesThisRailwayHost(base);
      return base;
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
