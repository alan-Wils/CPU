export type AppRole =
  | "OWNER"
  | "ADMIN"
  | "OPERATIONS_MANAGER"
  | "CULTIVATION_SPECIALIST"
  | "EXTRACTION_SPECIALIST"
  | "PACKAGING_SPECIALIST"
  | "FINANCIAL_ANALYST"
  | "DATABASE_ARCHITECT"
  | "FULL_STACK_DEVELOPER"
  | "QA_TESTER"
  | "VIEW_ONLY";

export type WorkflowStage = "CULTIVATION" | "EXTRACTION" | "PACKAGING";

export type AuthContext = {
  userId: string;
  companyId: string;
  role: AppRole;
};
