import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function stripWww(host: string): string {
  const h = host.trim().toLowerCase();
  return h.startsWith("www.") ? h.slice(4) : h;
}

function parseHostList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => {
      let t = s.trim().toLowerCase();
      const paren = t.indexOf("(");
      if (paren >= 0) t = t.slice(0, paren).trim();
      return t.replace(/\s+/g, "");
    })
    .filter(Boolean);
}

/**
 * Normalize hostnames so users always land on the canonical domain (fixes broken bookmarks /
 * DNS typos when those hosts still point at this deployment).
 *
 * Set on Vercel (Production):
 * - `NEXT_PUBLIC_CANONICAL_HOST` — e.g. `nexbatch.com` (exact host users should use)
 * - `NEXT_PUBLIC_SITE_HOST_ALIASES` — optional comma-separated **other** hostnames only (www variant,
 *   typos like `nextbatch.com`). Do **not** repeat the canonical host here.
 */
export function proxy(request: NextRequest) {
  const canonical = process.env.NEXT_PUBLIC_CANONICAL_HOST?.trim().toLowerCase();
  if (!canonical) return NextResponse.next();

  const hostHeader = request.headers.get("host")?.split(":")[0]?.toLowerCase() ?? "";
  if (!hostHeader || hostHeader.endsWith(".vercel.app")) return NextResponse.next();

  const canonHostOnly = canonical.includes(":") ? canonical.split(":")[0]! : canonical;
  /** Already on the canonical hostname — do not 308 (avoids loops if aliases include the same host). */
  if (hostHeader === canonHostOnly) return NextResponse.next();

  const aliases = parseHostList(process.env.NEXT_PUBLIC_SITE_HOST_ALIASES);

  const bareCanonical = stripWww(canonical);
  const bareCurrent = stripWww(hostHeader);

  const aliasHit = aliases.some((a) => {
    const bareA = stripWww(a);
    return hostHeader === a || bareCurrent === bareA;
  });

  const wwwMismatch =
    bareCurrent === bareCanonical && hostHeader !== canonical;

  if (!aliasHit && !wwwMismatch) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.hostname = canonHostOnly;
  return NextResponse.redirect(url, 308);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
