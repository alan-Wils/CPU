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

export function getCurrentUserRole() {
  const user = getAuthUser();
  return String(user?.role || "").toUpperCase();
}

export function hasMinimumRole(minimumRole: string) {
  const currentRole = getCurrentUserRole();
  const currentLevel = ROLE_LEVELS[currentRole] || 0;
  const requiredLevel = ROLE_LEVELS[String(minimumRole).toUpperCase()] || 0;

  return currentLevel >= requiredLevel;
}

export function canDeleteRecords() {
  return hasMinimumRole("MANAGER");
}

export function canAdmin() {
  return hasMinimumRole("ADMIN");
}

export function canEditRecords() {
  return hasMinimumRole("CULTIVATION");
}