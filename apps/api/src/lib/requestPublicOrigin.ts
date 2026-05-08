import type { Request } from "express";

/**
 * Build the public URL origin for redirects and stored upload URLs when the app sits behind Railway / a reverse proxy.
 * Falls back to `req.protocol` + `Host` when `X-Forwarded-*` is absent (local dev).
 */
export function requestPublicOrigin(req: Request): string {
    const forwardedHost = String(req.get("x-forwarded-host") || "")
        .split(",")[0]
        ?.trim();
    const host = forwardedHost || String(req.get("host") || "").trim();
    const forwardedProto = String(req.get("x-forwarded-proto") || "")
        .split(",")[0]
        ?.trim()
        .toLowerCase();
    const proto =
        forwardedProto === "http" || forwardedProto === "https"
            ? forwardedProto
            : String(req.protocol || "http").replace(/:$/, "");
    return `${proto}://${host}`;
}
