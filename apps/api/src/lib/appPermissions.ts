/**
 * NexBatch page + action permissions (JWT + `CompanyMembership.appPermissions`).
 * **Keep in sync with** `packages/shared/src/appPermissions.ts` (Next.js imports `@cpu/shared`;
 * Railway builds `apps/api` in isolation without `packages/shared`).
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

const PAGE_SET_OWNER_ADMIN: AppPagePermissionId[] = [...PAGE_SET_ALL];

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
  const allowed = new Set<string>([...ALL_APP_PERMISSION_IDS]);
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
  return g.includes(req);
}
