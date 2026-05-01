import { getAuthUser } from "@/lib/auth";

export const ROLE_LEVELS: Record<string, number> = {
  VIEW_ONLY: 1,
  CULTIVATION: 2,
  EXTRACTION: 2,
  PACKAGING: 2,
  MANAGER: 3,
  ADMIN: 4,
  OWNER: 5,
};

export function getCurrentRole() {
  return String(getAuthUser()?.role || "").toUpperCase();
}

export function hasRole(role: string) {
  return getCurrentRole() === String(role || "").toUpperCase();
}

export function hasMinimumRole(role: string) {
  const currentRole = getCurrentRole();
  return (ROLE_LEVELS[currentRole] || 0) >= (ROLE_LEVELS[role] || 0);
}

export function canWriteProduction() {
  return !hasRole("VIEW_ONLY") && hasMinimumRole("CULTIVATION");
}

export function canDeleteRecords() {
  return hasMinimumRole("MANAGER");
}

export function canManageUsers() {
  return hasMinimumRole("ADMIN");
}