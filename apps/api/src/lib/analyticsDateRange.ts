/** Inclusive UTC day bounds for `YYYY-MM-DD` query params (analytics, exports). */

export function parseYmdStartUtc(s: string): number {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
    if (!m)
        return NaN;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

export function parseYmdEndUtc(s: string): number {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
    if (!m)
        return NaN;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
}
