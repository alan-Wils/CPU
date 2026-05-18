/**
 * Derive Neon direct (non-pooler) host from a pooled `DATABASE_URL` when `DIRECT_DATABASE_URL` is unset.
 * Example: `…-pooler.c-5.us-east-1.aws.neon.tech` → `….c-5.us-east-1.aws.neon.tech`
 */
export function neonDirectDatabaseUrl(databaseUrl) {
  const raw = String(databaseUrl ?? "").trim();
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    const host = u.hostname;
    if (!host.includes("-pooler")) return raw;
    u.hostname = host.replace(/-pooler(?=\.)/, "");
    return u.toString();
  } catch {
    return raw.replace(/-pooler(\.c-\d)/i, "$1");
  }
}
