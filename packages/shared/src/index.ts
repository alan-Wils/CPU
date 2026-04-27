export const APP_ROLES = [
  "OWNER",
  "ADMIN",
  "OPERATIONS_MANAGER",
  "CULTIVATION_SPECIALIST",
  "EXTRACTION_SPECIALIST",
  "PACKAGING_SPECIALIST",
  "FINANCIAL_ANALYST",
  "DATABASE_ARCHITECT",
  "FULL_STACK_DEVELOPER",
  "QA_TESTER",
  "VIEW_ONLY"
] as const;

export type AppRole = (typeof APP_ROLES)[number];

export {
  extractPrimaryCheckAmount,
  mergeCheckParsedPreferBetter,
  parseCheckOcrTextWithConfidence,
  toFlatParsedForApi,
  type CheckFieldKey,
  type CheckParseResult,
  type CheckParsedFlat
} from "./checkCaptureParse.js";

export const ROLE_PERMISSIONS: Record<AppRole, string[]> = {
  OWNER: ["*"],
  ADMIN: ["users.manage", "workflow.manage", "audit.read", "finance.read", "config.manage"],
  OPERATIONS_MANAGER: ["workflow.manage", "labor.manage", "dashboard.read"],
  CULTIVATION_SPECIALIST: ["cultivation.manage", "dashboard.read"],
  EXTRACTION_SPECIALIST: ["extraction.manage", "dashboard.read"],
  PACKAGING_SPECIALIST: ["packaging.manage", "dashboard.read"],
  FINANCIAL_ANALYST: ["finance.read", "cpu.read", "labor.read"],
  DATABASE_ARCHITECT: ["schema.read", "audit.read"],
  FULL_STACK_DEVELOPER: ["platform.read", "workflow.read"],
  QA_TESTER: ["tests.execute", "workflow.read"],
  VIEW_ONLY: ["dashboard.read"]
};
