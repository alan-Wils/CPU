import { hasAppPermission } from "@cpu/shared";
import { getAuthUser } from "@/lib/auth";

export const ROLE_LEVELS: Record<string, number> = {
  VIEW_ONLY: 1,
  CULTIVATION: 2,
  CULTIVATION_SPECIALIST: 2,
  EXTRACTION: 2,
  EXTRACTION_SPECIALIST: 2,
  PACKAGING: 2,
  PACKAGING_SPECIALIST: 2,
  MANAGER: 3,
  OPERATIONS_MANAGER: 3,
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

/** Veg/Flower batch editor (placement + core fields): Manager-tier and above (`MANAGER`, `OPERATIONS_MANAGER`, Admin, Owner). */
export function canManageCultivationBatchPlacement(): boolean {
  if (typeof window === "undefined") return false;
  return hasMinimumRole("MANAGER");
}

export function canDeleteRecords() {
  if (typeof window === "undefined") return false;
  if (hasMinimumRole("MANAGER"))
    return true;
  const u = getAuthUser();
  return hasAppPermission(u?.permissions, "workflow.delete");
}

export function canAdmin() {
  return hasMinimumRole("ADMIN");
}

export function canEditRecords() {
  return hasMinimumRole("CULTIVATION");
}