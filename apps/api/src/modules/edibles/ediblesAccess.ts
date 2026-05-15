/** Edibles RBAC: JWT `page.edibles` or elevated company roles. */

export function userMayAccessEdibles(role: string, permissions: string[] | undefined): boolean {
  const r = String(role || "").trim().toUpperCase();
  if (r === "OWNER" || r === "ADMIN" || r === "OPERATIONS_MANAGER") return true;
  if (r === "EDIBLES" || r === "EDIBLES_MANAGER") return true;
  return Array.isArray(permissions) && permissions.includes("page.edibles");
}

export function isEdiblesManagerRole(role: string): boolean {
  const r = String(role || "").trim().toUpperCase();
  return r === "EDIBLES_MANAGER" || r === "OWNER" || r === "ADMIN" || r === "OPERATIONS_MANAGER";
}
