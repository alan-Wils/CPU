export const APP_ROLES = [
  "OWNER",
  "ADMIN",
  "OPERATIONS_MANAGER",
  "CULTIVATION_SPECIALIST",
  "EXTRACTION_SPECIALIST",
  "PACKAGING_SPECIALIST",
  "FINANCIAL_ANALYST",
  "SALES_SPECIALIST",
  "DATABASE_ARCHITECT",
  "FULL_STACK_DEVELOPER",
  "QA_TESTER",
  "VIEW_ONLY"
] as const;

export type AppRole = (typeof APP_ROLES)[number];

export {
  ALL_APP_PERMISSION_IDS,
  APP_EXTRA_PERMISSION_IDS,
  APP_PAGE_PERMISSION_IDS,
  APP_PERMISSION_LABELS,
  appPermissionSetsEqual,
  computeEffectiveAppPermissions,
  defaultPagePermissionsForRole,
  hasAppPermission,
  isAdminOnlyRole,
  isElevatedManagerRole,
  isOwnerOrAdminRole,
  normalizeAppPermissionList,
  type AppExtraPermissionId,
  type AppPagePermissionId,
  type AppPermissionId,
} from "./appPermissions.js";

export {
  extractPrimaryCheckAmount,
  mergeCheckParsedPreferBetter,
  parseCheckOcrTextWithConfidence,
  parseMicrFromRegionSnippet,
  toFlatParsedForApi,
  type CheckFieldKey,
  type CheckParseResult,
  type CheckParsedFlat
} from "./checkCaptureParse.js";

export {
  computeAllocatedDryCanopySqFt,
  computeDryYieldGPerSqFt,
  meanFinite,
  sumTableSquareFeetFromIds,
  type FlowerRoomForSqFt,
} from "./strainCanopyMath.js";

export {
  additiveMassFractionFromGoals,
  computeMctCarrierBlend,
  estimatedGummyWeightGramsFromMoldMl,
  planPectinMultiAdditiveBatch,
  planPectinSingleAdditiveBatch,
  type PectinAdditiveLineInput,
  type PectinMctCarrierBlend,
  type PectinMultiAdditiveInput,
  type PectinMultiAdditivePlan,
  type PectinSingleAdditiveInput,
  type PectinSingleAdditivePlan,
} from "./pectinMeltToMakeFormula.js";

export const ROLE_PERMISSIONS: Record<AppRole, string[]> = {
  OWNER: ["*"],
  ADMIN: ["users.manage", "workflow.manage", "audit.read", "finance.read", "config.manage"],
  OPERATIONS_MANAGER: ["workflow.manage", "labor.manage", "dashboard.read"],
  CULTIVATION_SPECIALIST: ["cultivation.manage", "dashboard.read"],
  EXTRACTION_SPECIALIST: ["extraction.manage", "dashboard.read"],
  PACKAGING_SPECIALIST: ["packaging.manage", "dashboard.read"],
  FINANCIAL_ANALYST: ["finance.read", "cpu.read", "labor.read"],
  SALES_SPECIALIST: ["dashboard.read", "cpu.read"],
  DATABASE_ARCHITECT: ["schema.read", "audit.read"],
  FULL_STACK_DEVELOPER: ["platform.read", "workflow.read"],
  QA_TESTER: ["tests.execute", "workflow.read"],
  VIEW_ONLY: ["dashboard.read"]
};
