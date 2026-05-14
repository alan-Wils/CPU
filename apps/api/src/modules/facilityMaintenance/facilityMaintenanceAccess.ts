export function userMayAccessFacilitiesMaintenance(role: string, permissions: string[] | undefined): boolean {
  const r = String(role || "").trim().toUpperCase();
  if (r === "OWNER" || r === "ADMIN" || r === "OPERATIONS_MANAGER")
    return true;
  return Array.isArray(permissions) && permissions.includes("page.facilities-maintenance");
}
