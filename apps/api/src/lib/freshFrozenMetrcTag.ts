/** True when tag is missing or an auto-generated split placeholder (e.g. BUNDLE, BUNDLE-3). */
export function isPlaceholderFreshFrozenMetrcTag(tag: unknown): boolean {
    const t = String(tag ?? "").trim();
    if (!t) return true;
    return /^BUNDLE(?:-\d+)?$/i.test(t);
}
