import { z } from "zod";

export const loginSchema = z.object({
  companyCode: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/).optional(),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  remember: z.boolean().optional()
});

export const resetRequestSchema = z.object({
  email: z.string().email()
});

export const acceptInviteSchema = z.object({
  token: z.string().min(16).max(256),
  password: z.string().min(8).max(128)
});

export const createCompanySchema = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/),
  ownerEmail: z.string().email(),
  ownerPassword: z.string().min(12).max(128)
});

export const updateCompanySchema = z.object({
  name: z.string().min(2).max(100).optional(),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/).optional()
});

export const companyIdParam = z.object({ companyId: z.string().cuid() });

export const assignOwnerSchema = z.object({
  targetUserId: z.string().cuid()
});

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12).max(128),
  role: z.enum([
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
  ])
});

const positiveGrams = z.number().nonnegative().max(1_000_000_000);
const positiveGramsStrict = z.number().positive().max(1_000_000_000);

export const cultivationCreateSchema = z.object({
  strain: z.string().min(2).max(80),
  strainAcronym: z.string().min(1).max(6).optional(),
  plantedAt: z.coerce.date(),
  aGradeFlowerGrams: positiveGrams,
  popcornGrams: positiveGrams,
  trimGrams: positiveGrams,
  freshFrozenGrams: positiveGrams,
  room: z.string().max(50).optional(),
  bay: z.string().max(50).optional(),
  table: z.string().max(50).optional()
});

export const batchIdParam = z.object({ batchId: z.string().cuid() });
export const runIdParam = z.object({ runId: z.string().cuid() });
export const lotIdParam = z.object({ lotId: z.string().cuid() });
export const exRunIdParam = z.object({ extractionRunId: z.string().cuid() });
export const sourcePackageIdParam = z.object({ sourcePackageId: z.string().cuid() });
export const taskLogIdParam = z.object({ taskLogId: z.string().cuid() });

export const trimSetSchema = z.object({
  toExtractionGrams: z.number().nonnegative(),
  consumedGrams: z.number().nonnegative()
});

export const freshSetSchema = z.object({
  toExtractionGrams: z.number().nonnegative(),
  extractionRunId: z.string().cuid().optional()
});

export const cultPackStartSchema = z.object({
  line: z.enum(["A_GRADE_FLOWER", "POPCORN"]),
  mode: z.enum(["new", "add"]),
  openRunId: z.string().cuid().optional()
});

export const cultWeighSchema = z.object({
  netProductGrams: z.number().nonnegative(),
  terpeneGrams: z.number().nonnegative().default(0),
  note: z.string().max(500).optional()
});

export const exBiomassSchema = z.object({
  sourceType: z.enum(["DRY_TRIM", "FRESH_FROZEN"]),
  grams: positiveGramsStrict,
  sockWeightGrams: z.number().positive().optional()
});

export const sealExtractionSchema = z.object({
  method: z.string().min(1).max(100),
  supplyUsed: z.string().max(200).optional()
});

export const exCompleteSchema = z.object({
  outputGrams: z.number().nonnegative()
});

export const extractionCreateShellSchema = z.object({
  cultivationBatchId: z.string().cuid()
});

export const extPackWeighSchema = z.object({
  netOutputGrams: z.number().nonnegative(),
  terpeneGrams: z.number().nonnegative()
});

export const extractionPackagingStartSchema = z.object({
  sku: z.string().min(1).max(100),
  gramsPerUnit: z.number().positive().max(100),
  defaultTemplate: z.string().max(120).optional()
});

export const cultivationUpdateSchema = z.object({
  room: z.string().max(50).optional(),
  bay: z.string().max(50).optional(),
  table: z.string().max(50).optional(),
  plantedAt: z.coerce.date().optional()
});

export const sourcePackageCreateSchema = z.object({
  cultivationBatchId: z.string().cuid(),
  role: z.enum(["A_GRADE_FLOWER", "POPCORN", "DRY_TRIM", "FRESH_FROZEN"]),
  canonicalName: z.string().min(2).max(120)
});

export const sourcePackageUpdateSchema = z.object({
  canonicalName: z.string().min(2).max(120)
});

export const sourcePackageConsumeSchema = z.object({
  grams: z.number().positive().max(1_000_000_000)
});

export const extractionRunUpdateSchema = z.object({
  method: z.string().max(100).optional(),
  supplyUsed: z.string().max(200).optional()
});

export const packagingLotUpdateSchema = z.object({
  sku: z.string().min(1).max(100).optional(),
  gramsPerUnit: z.number().positive().max(100).optional(),
  defaultTemplate: z.string().max(120).optional()
});

export const taskLogCreateSchema = z.object({
  stage: z.enum(["CULTIVATION", "EXTRACTION", "PACKAGING"]),
  note: z.string().min(4).max(500),
  minutes: z.number().int().min(1).max(24 * 60),
  /** Cultivation cuid, dry-flower id, or display chain id (e.g. ACRO.YY-####) for filtering. */
  referenceId: z.string().min(1).max(200).optional()
});

export const laborEntryCreateSchema = z.object({
  stage: z.enum(["CULTIVATION", "EXTRACTION", "PACKAGING"]),
  taskType: z.string().min(2).max(64).default("CPU_OPERATIONAL_LABOR"),
  hours: z.number().positive().max(24),
  hourlyRate: z.number().positive().max(500),
  referenceId: z.string().cuid().optional(),
  cultivationBatchId: z.string().cuid().optional()
});

export const adminUserStatusSchema = z.object({
  isActive: z.boolean()
});

export const adminUserUpdateSchema = z.object({
  email: z.string().email().optional(),
  role: z
    .enum([
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
    ])
    .optional(),
  isActive: z.boolean().optional()
});

export const inviteCreateSchema = z.object({
  email: z.string().email(),
  role: z.enum([
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
  ])
});

export const configUpsertSchema = z.object({
  key: z.string().min(2).max(100),
  value: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
});
