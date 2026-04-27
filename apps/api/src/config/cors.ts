/** Parse CORS_ORIGIN: single URL, comma-separated allowlist, or `*`. */
export function parseCorsOrigin(value) {
    const t = value.trim();
    if (t === "*")
        return true;
    if (t.includes(",")) {
        const parts = t.split(",").map((s) => s.trim()).filter(Boolean);
        if (parts.length === 0)
            return true;
        return parts.length === 1 ? parts[0] : parts;
    }
    return t;
}
