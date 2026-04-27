import { getAuthUser } from "@/lib/auth";

export function canDeleteRecords() {
  const role = String(getAuthUser()?.role || "").toUpperCase();
  return role === "OWNER" || role === "ADMIN" || role === "MANAGER";
}
