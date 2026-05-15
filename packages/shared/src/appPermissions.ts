/**
 * NexBatch page + action permissions (stored on `CompanyMembership.appPermissions`, JWT `permissions`, admin UI).
 * `null` in DB means “use {@link defaultPagePermissionsForRole} for this user role”.
 *
 * **API duplicate:** `apps/api/src/lib/appPermissions.ts` — Railway builds `apps/api` without this package;
 * keep both files aligned when changing permission ids, defaults, or `computeEffectiveAppPermissions` / `isOwnerOrAdminRole`.
 */
export const APP_PAGE_PERMISSION_IDS = [
  "page.cultivation",
  "page.extraction",
  "page.packaging",
  "page.edibles",
  "page.inventory",
  "page.orders",
  "page.data-hub",
  "page.analytics",
  "page.rewards",
  "page.facilities-maintenance",
  "page.sales-seller",
  "page.sales-marketplace",
] as const;

export type AppPagePermissionId = (typeof APP_PAGE_PERMISSION_IDS)[number];

export const APP_EXTRA_PERMISSION_IDS = ["workflow.delete"] as const;
export type AppExtraPermissionId = (typeof APP_EXTRA_PERMISSION_IDS)[number];

export const ALL_APP_PERMISSION_IDS = [
  ...APP_PAGE_PERMISSION_IDS,
  ...APP_EXTRA_PERMISSION_IDS,
] as const;

export type AppPermissionId = (typeof ALL_APP_PERMISSION_IDS)[number];

export const APP_PERMISSION_LABELS: Record<AppPermissionId, string> = {
  "page.cultivation": "Cultivation",
  "page.extraction": "Extraction",
  "page.packaging": "Packaging",
  "page.edibles": "Edibles",
  "page.inventory": "Inventory",
  "page.orders": "Orders",
  "page.data-hub": "Data Hub",
  "page.analytics": "Analytics",
  "page.rewards": "Rewards",
  "page.facilities-maintenance": "Facilities Maintenance",
  "page.sales-seller": "Seller Platform",
  "page.sales-marketplace": "Marketplace",
  "workflow.delete": "Delete workflow records (batches, runs, lots, source packages)",
};

const PAGE_SET_ALL: AppPagePermissionId[] = [
  "page.cultivation",
  "page.extraction",
  "page.packaging",
  "page.edibles",
  "page.inventory",
  "page.orders",
  "page.data-hub",
  "page.analytics",
  "page.rewards",
  "page.facilities-maintenance",
  "page.sales-seller",
  "page.sales-marketplace",
];

/** OWNER / ADMIN: all workflow pages + admin UI stays role-gated separately. */
const PAGE_SET_OWNER_ADMIN: AppPagePermissionId[] = [...PAGE_SET_ALL];

/** Operations manager: same production floor as legacy `PageAccessGate` manager bypass. */
const PAGE_SET_OPERATIONS_MANAGER: AppPagePermissionId[] = [...PAGE_SET_ALL];

/** OWNER / ADMIN always get full workflow pages (JWT ignores membership overrides). */
export function isOwnerOrAdminRole(role: string): boolean {
  const r = String(role || "").toUpperCase();
  return r === "OWNER" || r === "ADMIN";
}

/** OWNER, ADMIN, or Operations Manager — used where legacy “elevated” wording still applies. */
export function isElevatedManagerRole(role: string): boolean {
  const r = String(role || "").toUpperCase();
  return r === "OWNER" || r === "ADMIN" || r === "OPERATIONS_MANAGER";
}

export function isAdminOnlyRole(role: string): boolean {
  const r = String(role || "").toUpperCase();
  return r === "OWNER" || r === "ADMIN";
}

export function defaultPagePermissionsForRole(role: string): AppPermissionId[] {
  const r = String(role || "").toUpperCase();
  if (r === "OWNER" || r === "ADMIN")
    return [...PAGE_SET_OWNER_ADMIN];
  if (r === "OPERATIONS_MANAGER")
    return [...PAGE_SET_OPERATIONS_MANAGER];
  if (r === "CULTIVATION_SPECIALIST" || r === "CULTIVATION")
    return ["page.cultivation", "page.data-hub"];
  if (r === "EXTRACTION_SPECIALIST" || r === "EXTRACTION")
    return ["page.extraction", "page.data-hub"];
  if (r === "PACKAGING_SPECIALIST" || r === "PACKAGING")
    return ["page.packaging", "page.data-hub"];
  if (r === "EDIBLES") return ["page.edibles", "page.data-hub"];
  if (r === "EDIBLES_MANAGER")
    return ["page.edibles", "page.data-hub", "page.analytics"];
  if (r === "FACILITY_MAINTENANCE_SPECIALIST")
    return ["page.facilities-maintenance", "page.data-hub"];
  if (r === "SALES_SPECIALIST")
    return ["page.sales-seller", "page.sales-marketplace", "page.orders", "page.data-hub"];
  if (r === "VIEW_ONLY")
    return ["page.data-hub"];
  if (r === "FINANCIAL_ANALYST") {
    return ["page.data-hub", "page.analytics"];
  }
  if (r === "DATABASE_ARCHITECT" || r === "FULL_STACK_DEVELOPER" || r === "QA_TESTER") {
    return ["page.data-hub"];
  }
  return ["page.data-hub"];
}

export function normalizeAppPermissionList(raw: unknown): AppPermissionId[] {
  if (!Array.isArray(raw))
    return [];
  const allowed = new Set<string>(ALL_APP_PERMISSION_IDS);
  const out: AppPermissionId[] = [];
  for (const x of raw) {
    if (typeof x !== "string")
      continue;
    const t = x.trim();
    if (allowed.has(t) && !out.includes(t as AppPermissionId))
      out.push(t as AppPermissionId);
  }
  return out;
}

/**
 * Effective permission set for JWT + UI.
 * - Elevated roles ignore DB overrides (full floor access for OM; owner/admin implied).
 * - Otherwise: DB JSON array replaces defaults when present; `null`/`undefined` uses role defaults.
 */
export function computeEffectiveAppPermissions(role: string, storedMembershipJson: unknown): AppPermissionId[] {
  const r = String(role || "").toUpperCase();
  if (r === "OWNER" || r === "ADMIN")
    return [...PAGE_SET_OWNER_ADMIN];
  if (r === "OPERATIONS_MANAGER") {
    if (storedMembershipJson === null || storedMembershipJson === undefined)
      return [...PAGE_SET_OPERATIONS_MANAGER];
    const listOm = normalizeAppPermissionList(storedMembershipJson);
    /** Empty array (or all-invalid entries) in DB — treat as no override so JWT/nav are not blank. */
    if (listOm.length === 0)
      return [...PAGE_SET_OPERATIONS_MANAGER];
    return listOm;
  }
  if (storedMembershipJson === null || storedMembershipJson === undefined)
    return defaultPagePermissionsForRole(r);
  const list = normalizeAppPermissionList(storedMembershipJson);
  if (list.length === 0)
    return defaultPagePermissionsForRole(r);
  return list;
}

export function appPermissionSetsEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  const aa = [...(a || [])].map((s) => String(s)).sort();
  const bb = [...(b || [])].map((s) => String(s)).sort();
  if (aa.length !== bb.length)
    return false;
  return aa.every((v, i) => v === bb[i]);
}

export function hasAppPermission(
  granted: string[] | undefined,
  required: AppPermissionId | AppPagePermissionId | AppExtraPermissionId | string,
): boolean {
  const req = String(required);
  const g = granted || [];
  if (g.includes(req))
    return true;
  return false;
}
