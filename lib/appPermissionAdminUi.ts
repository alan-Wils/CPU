/**
 * Admin UI permission ids + labels (Next.js only).
 * Keep aligned with `packages/shared/src/appPermissions.ts` and `apps/api/src/lib/appPermissions.ts`.
 */
export const ALL_APP_PERMISSION_IDS = [
  "page.cultivation",
  "page.extraction",
  "page.packaging",
  "page.inventory",
  "page.orders",
  "page.data-hub",
  "page.analytics",
  "page.rewards",
  "page.facilities-maintenance",
  "workflow.delete",
] as const;

export type AdminUiPermissionId = (typeof ALL_APP_PERMISSION_IDS)[number];

export const APP_PERMISSION_LABELS: Record<AdminUiPermissionId, string> = {
  "page.cultivation": "Cultivation",
  "page.extraction": "Extraction",
  "page.packaging": "Packaging",
  "page.inventory": "Inventory",
  "page.orders": "Orders",
  "page.data-hub": "Data Hub",
  "page.analytics": "Analytics",
  "page.rewards": "Rewards",
  "page.facilities-maintenance": "Facilities Maintenance",
  "workflow.delete": "Delete workflow records (batches, runs, lots, source packages)",
};

/** Grouped for Admin → Users → Edit employee (same ids as {@link ALL_APP_PERMISSION_IDS}). */
export const ADMIN_PERMISSION_SECTIONS: ReadonlyArray<{
  title: string;
  subtitle?: string;
  ids: readonly AdminUiPermissionId[];
}> = [
  {
    title: "Production floor",
    ids: ["page.cultivation", "page.extraction", "page.packaging"],
  },
  {
    title: "Inventory, orders, and analytics",
    subtitle:
      "Uncheck to hide these pages from the navigation bar and home dashboard for this employee.",
    ids: ["page.inventory", "page.orders", "page.analytics"],
  },
  {
    title: "Data and rewards",
    ids: ["page.data-hub", "page.rewards"],
  },
  {
    title: "Facilities",
    ids: ["page.facilities-maintenance"],
  },
  {
    title: "Dangerous actions",
    ids: ["workflow.delete"],
  },
];

const PAGE_SET_ALL: AdminUiPermissionId[] = [
  "page.cultivation",
  "page.extraction",
  "page.packaging",
  "page.inventory",
  "page.orders",
  "page.data-hub",
  "page.analytics",
  "page.rewards",
  "page.facilities-maintenance",
];

export function defaultPagePermissionsForRole(role: string): AdminUiPermissionId[] {
  const r = String(role || "").toUpperCase();
  if (r === "OWNER" || r === "ADMIN")
    return [...PAGE_SET_ALL];
  if (r === "OPERATIONS_MANAGER")
    return [...PAGE_SET_ALL];
  if (r === "CULTIVATION_SPECIALIST" || r === "CULTIVATION")
    return ["page.cultivation", "page.data-hub"];
  if (r === "EXTRACTION_SPECIALIST" || r === "EXTRACTION")
    return ["page.extraction", "page.data-hub"];
  if (r === "PACKAGING_SPECIALIST" || r === "PACKAGING")
    return ["page.packaging", "page.data-hub"];
  if (r === "FACILITY_MAINTENANCE_SPECIALIST")
    return ["page.facilities-maintenance", "page.data-hub"];
  if (r === "VIEW_ONLY")
    return ["page.data-hub"];
  if (
    r === "FINANCIAL_ANALYST" ||
    r === "DATABASE_ARCHITECT" ||
    r === "FULL_STACK_DEVELOPER" ||
    r === "QA_TESTER"
  ) {
    return ["page.data-hub"];
  }
  return ["page.data-hub"];
}

export function isOwnerOrAdminRoleKey(role: string): boolean {
  const r = String(role || "").trim().toUpperCase();
  return r === "OWNER" || r === "ADMIN";
}

/** Every id for “full access” display in admin when role is Owner or Admin. */
export function fullAccessPermissionIds(): AdminUiPermissionId[] {
  return [...ALL_APP_PERMISSION_IDS];
}
