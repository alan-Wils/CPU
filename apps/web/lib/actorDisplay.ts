import type { ActorIdentity } from "./taskLogTypes";

const DEFAULT_USER_FALLBACK = "System User";

export function resolveActorIdentity(
  primary: unknown,
  fallback?: unknown,
  defaultLabel = DEFAULT_USER_FALLBACK
): ActorIdentity {
  const source = (primary || fallback || {}) as Record<string, unknown>;
  const username = String(
    source.username ||
      source.name ||
      source.userName ||
      source.user ||
      (typeof source.email === "string" ? source.email.split("@")[0] : "") ||
      defaultLabel
  ).trim();
  return {
    userId: String(source.userId || source.id || "").trim() || undefined,
    username: username || defaultLabel,
    email: String(source.email || "").trim() || undefined,
    role: String(source.role || "").trim() || undefined
  };
}

export function formatActorDisplay(
  value: unknown,
  defaultLabel = DEFAULT_USER_FALLBACK,
  includeRole = true
): string {
  const actor = resolveActorIdentity(value, undefined, defaultLabel);
  const role = includeRole && actor.role ? ` (${actor.role})` : "";
  return `${actor.username || defaultLabel}${role}`;
}
