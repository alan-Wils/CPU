/**
 * NexBatch page + action permissions (stored on `CompanyMembership.appPermissions`, JWT `permissions`, admin UI).
 * `null` in DB means “use {@link defaultPagePermissionsForRole} for this user role”.
 */
export const APP_PAGE_PERMISSION_IDS = [
  "page.cultivation",
  "page.extraction",
  "page.packaging",
  "page.data-hub",
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
  "page.data-hub": "Data Hub",
  "workflow.delete": "Delete workflow records (batches, runs, lots, source packages)",
};

const PAGE_SET_ALL: AppPagePermissionId[] = [
  "page.cultivation",
  "page.extraction",
  "page.packaging",
  "page.data-hub",
];

/** OWNER / ADMIN: all workflow pages + admin UI stays role-gated separately. */
const PAGE_SET_OWNER_ADMIN: AppPagePermissionId[] = [...PAGE_SET_ALL];

/** Operations manager: same production floor as legacy `PageAccessGate` manager bypass. */
const PAGE_SET_OPERATIONS_MANAGER: AppPagePermissionId[] = [...PAGE_SET_ALL];

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
  if (r === "OPERATIONS_MANAGER")
    return [...PAGE_SET_OPERATIONS_MANAGER];
  if (storedMembershipJson === null || storedMembershipJson === undefined)
    return defaultPagePermissionsForRole(r);
  return normalizeAppPermissionList(storedMembershipJson);
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
