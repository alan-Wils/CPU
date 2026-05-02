/** Canonical `Origin` string: scheme + host + port (no path, no trailing slash). */
export function normalizeOriginForCors(raw: string): string | null {
    const t = raw.trim();
    if (!t) return null;
    try {
        return new URL(t).origin;
    }
    catch {
        return null;
    }
}

/** Human-readable allowlist for startup logs (normalized origins). */
export function describeCorsAllowlist(value: string): string[] | "all" {
    const t = value.trim();
    if (t === "*")
        return "all";
    const parts = t.includes(",")
        ? t.split(",").map((s) => s.trim()).filter(Boolean)
        : [t];
    return parts
        .map((p) => normalizeOriginForCors(p))
        .filter((x): x is string => Boolean(x));
}

/**
 * Express `cors` `origin` option: allowlist with normalized comparison so
 * `https://App.com` matches browser `https://app.com`, and trailing slashes
 * in env don't break after a domain change.
 */
export function createCorsOriginResolver(value: string) {
    const t = value.trim();
    if (t === "*")
        return true;
    const parts = t.includes(",")
        ? t.split(",").map((s) => s.trim()).filter(Boolean)
        : [t];
    const allowed = parts
        .map((p) => normalizeOriginForCors(p))
        .filter((x): x is string => Boolean(x));
    if (allowed.length === 0)
        return true;

    return (origin: string | undefined, callback: (err: Error | null, allow?: boolean | string) => void) => {
        if (!origin) {
            callback(null, true);
            return;
        }
        const reqNorm = normalizeOriginForCors(origin);
        if (!reqNorm) {
            callback(null, false);
            return;
        }
        if (allowed.includes(reqNorm)) {
            callback(null, origin);
            return;
        }
        callback(null, false);
    };
}
