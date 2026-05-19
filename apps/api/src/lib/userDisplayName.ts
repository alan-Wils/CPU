/** Human-readable name for logs, UI, and employee lists. Prefers stored display name over email local-part. */
export function userDisplayName(input: {
    displayName?: string | null;
    email?: string | null;
}): string {
    const stored = String(input.displayName ?? "").trim();
    if (stored)
        return stored;
    const email = String(input.email ?? "").trim().toLowerCase();
    if (!email)
        return "User";
    const at = email.indexOf("@");
    return at > 0 ? email.slice(0, at) : email;
}
