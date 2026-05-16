import { ALL_APP_PERMISSION_IDS } from "../lib/appPermissions.js";
import { z } from "zod";

/** Map short / display labels from older clients to Prisma `UserRole` strings. */
export function normalizeLegacyUserRoleInput(raw: string): string {
    const t = raw.trim();
    const exact: Record<string, string> = {
        MANAGER: "OPERATIONS_MANAGER",
        CULTIVATION: "CULTIVATION_SPECIALIST",
        EXTRACTION: "EXTRACTION_SPECIALIST",
        PACKAGING: "PACKAGING_SPECIALIST",
    };
    if (exact[t])
        return exact[t];
    const loose = t.toLowerCase().replace(/\s+/g, "");
    const fuzzy: Record<string, string> = {
        manager: "OPERATIONS_MANAGER",
        cultivation: "CULTIVATION_SPECIALIST",
        extraction: "EXTRACTION_SPECIALIST",
        packaging: "PACKAGING_SPECIALIST",
    };
    if (fuzzy[loose])
        return fuzzy[loose];
    return t;
}

function preprocessBodyNormalizeUserRole(raw: unknown): unknown {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return raw;
    const o = { ...(raw as Record<string, unknown>) };
    if (typeof o.role === "string")
        o.role = normalizeLegacyUserRoleInput(o.role);
    return o;
}

/** Legacy UI sends `username` + optional `companyCode: ""`. Normalize before validation. */
export const loginSchema = z.preprocess((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return raw;
    const o = { ...(raw as Record<string, unknown>) };
    const userPart =
        typeof o.username === "string" ? o.username.trim() : "";
    const emailPart =
        typeof o.email === "string" ? o.email.trim() : "";
    o.email = emailPart || userPart || "";
    delete o.username;
    if (o.companyCode === "" || o.companyCode === null || o.companyCode === undefined)
        delete o.companyCode;
    else if (typeof o.companyCode === "string")
        o.companyCode = o.companyCode.trim().toLowerCase();
    return o;
}, z.object({
    companyCode: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/).optional(),
    /** Full email, or local-part only when `companyCode` is set (AuthService). */
    email: z.string().min(1).max(200),
    password: z.string().min(8).max(128),
    remember: z.coerce.boolean().optional(),
}).superRefine((val, ctx) => {
    if (!val.companyCode && !String(val.email).includes("@")) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "NexBatch portal sign-in requires your full email address.",
            path: ["email"],
        });
    }
}));
export const selectCompanySchema = z.object({
    companyId: z.string().min(8).max(80),
});
export const resetRequestSchema = z.object({
    email: z.string().email()
});
export const passwordResetConfirmSchema = z.object({
    token: z.string().min(16).max(512),
    password: z.string().min(8).max(128),
});
export const adminUserIdParam = z.object({
    userId: z.string().cuid(),
});
export const acceptInviteSchema = z.object({
    token: z.string().min(16).max(256),
    password: z.string().min(8).max(128)
});
export const invitePreviewQuerySchema = z.object({
    token: z.string().min(16).max(256),
});
/** Initial CompanyServiceSettings when NexBatch portal creates a tenant (optional for backward compatibility). */
export const createCompanyWorkspaceServicesSchema = z.object({
    productionEnabled: z.boolean(),
    salesSellerEnabled: z.boolean(),
    salesBuyerEnabled: z.boolean(),
    leafLinkInventorySyncEnabled: z.boolean(),
});

export const createCompanySchema = z.object({
    name: z.string().min(2).max(100),
    slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/),
    ownerEmail: z.string().email(),
    workspaceServices: createCompanyWorkspaceServicesSchema.optional(),
});
/**
 * UI tier for NexBatch portal invites; maps to `NexBatchPlatformRole` on the server.
 * `staff` → Prisma `admin` (generic NexBatch Staff).
 */
export const inviteNexBatchStaffSchema = z.object({
    email: z.string().email().max(200),
    tier: z.enum(["owner", "nexbatch_admin", "management", "staff"]),
    /** Subset of companies this actor may attach; omit to grant all workspaces in scope. */
    companyIds: z.array(z.string().cuid()).min(1).optional(),
});

export const nexbatchStaffCompanyAccessSchema = z
    .object({
        add: z.array(z.string().cuid()).optional(),
        remove: z.array(z.string().cuid()).optional(),
    })
    .superRefine((d, ctx) => {
        const adds = d.add?.length ?? 0;
        const removes = d.remove?.length ?? 0;
        if (!adds && !removes) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Provide at least one company id in add or remove.",
                path: ["add"],
            });
        }
    });
export const updateNexBatchStaffSchema = z.object({
    tier: z.enum(["owner", "nexbatch_admin", "management", "staff"]).optional(),
    active: z.boolean().optional(),
}).superRefine((data, ctx) => {
    if (data.tier === undefined && data.active === undefined) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provide at least one field to update.",
            path: ["tier"],
        });
    }
});
export const updateCompanySchema = z.preprocess((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return raw;
    const o = { ...(raw as Record<string, unknown>) };
    if (typeof o.code === "string" && o.slug === undefined) {
        const normalized = o.code
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-+|-+$/g, "");
        if (normalized.length >= 2)
            o.slug = normalized;
    }
    delete o.code;
    return o;
}, z.object({
    name: z.string().min(2).max(100).optional(),
    slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/).optional(),
}));
export const companyIdParam = z.object({ companyId: z.string().cuid() });
export const inviteIdParam = z.object({ inviteId: z.string().cuid() });
export const assignOwnerSchema = z.object({
    targetUserId: z.string().cuid()
});
const createUserRoleEnum = z.enum([
    "OWNER",
    "ADMIN",
    "OPERATIONS_MANAGER",
    "CULTIVATION_SPECIALIST",
    "EXTRACTION_SPECIALIST",
    "PACKAGING_SPECIALIST",
    "EDIBLES",
    "EDIBLES_MANAGER",
    "FACILITY_MAINTENANCE_SPECIALIST",
    "SALES_SPECIALIST",
    "FINANCIAL_ANALYST",
    "DATABASE_ARCHITECT",
    "FULL_STACK_DEVELOPER",
    "QA_TESTER",
    "VIEW_ONLY"
]);
export const createUserSchema = z.preprocess(preprocessBodyNormalizeUserRole, z.object({
    email: z.string().email(),
    password: z.string().min(12).max(128),
    role: createUserRoleEnum
}));
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
/** Register finished oil that never went through NexBatch extraction steps — creates a completed `ExtractionRun` (and optionally a minimal cultivation batch) for packaging + edibles pool. */
export const legacyOilIntakeSchema = z
    .object({
        cultivationBatchId: z.string().cuid().optional(),
        strain: z.string().min(1).max(120).optional(),
        strainAcronym: z.string().max(8).optional(),
        plantedAt: z.coerce.date().optional(),
        outputGrams: z.number().positive().max(1_000_000),
        inputGrams: z.number().nonnegative().max(1_000_000).optional(),
        productType: z.string().min(1).max(120).optional(),
        productCategory: z.enum(["LIVE", "CURED_WAX"]).optional(),
        externalReference: z.string().max(500).optional().nullable(),
        notes: z.string().max(8000).optional().nullable(),
    })
    .strict()
    .refine((d) => Boolean(d.cultivationBatchId?.trim()) || Boolean(d.strain?.trim()), {
        message: "Provide cultivationBatchId (existing NexBatch cultivation) or strain (creates a minimal shell batch for linkage).",
        path: ["cultivationBatchId"],
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
const jsonRecordSchema = z.record(z.string(), z.unknown());
export const cultivationUpdateSchema = z.object({
    room: z.string().max(50).optional(),
    bay: z.string().max(50).optional(),
    table: z.string().max(50).optional(),
    plantedAt: z.coerce.date().optional(),
    complete: z.boolean().optional(),
    /** Serialized cultivation page state (tasks, METRC fields, stage labels, etc.). */
    cultivationUiState: z.union([jsonRecordSchema, z.null()]).optional()
});

const motherPlantRowSchema = z.object({
    id: z.string().min(1).max(80),
    strain: z.string().min(1).max(120),
    acronym: z.string().max(40).optional(),
    tag: z.string().max(80).optional(),
    notes: z.string().max(2000).optional(),
    location: z.string().max(200).optional(),
    status: z.enum(["active", "retired"]),
    sourceBatchId: z.string().min(1).max(80),
    sourceStage: z.enum(["Clones", "Veg"]),
    promotedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    createdAt: z.string().min(1).max(40),
    updatedAt: z.string().min(1).max(40),
});

export const cultivationMotherPlantsPutSchema = z.object({
    motherPlants: z.array(motherPlantRowSchema).max(5000),
});
export const checkUploadSchema = z.object({
    fileName: z.string().min(1).max(200).optional(),
    mimeType: z.enum(["image/jpeg", "image/jpg", "image/png", "image/webp"]),
    dataBase64: z.string().min(20).max(20_000_000)
});
export const checkExtractSchema = z.object({
    imageUrl: z.string().url().optional(),
    dataBase64: z.string().min(20).max(20_000_000).optional(),
    mimeType: z.enum(["image/jpeg", "image/jpg", "image/png", "image/webp"]).optional()
});
export const checkSaveSchema = z.object({
    checkDate: z.coerce.date().optional(),
    amount: z.number().nonnegative().max(10_000_000).optional(),
    checkNumber: z.string().max(50).optional(),
    payerName: z.string().max(200).optional(),
    routingNumber: z.string().max(32).optional(),
    accountNumber: z.string().max(32).optional(),
    bankName: z.string().max(200).optional(),
    memo: z.string().max(500).optional(),
    invoiceNumber: z.string().max(4000).optional(),
    imageUrl: z.string().url(),
    stubImageUrl: z.string().url().optional(),
    rawOcrJson: z.unknown().optional()
});
export const checkCaptureUpdateSchema = checkSaveSchema
    .partial()
    .extend({
        stubImageUrl: z.union([z.string().url(), z.null()]).optional()
    })
    .superRefine((data, ctx) => {
        const entries = Object.entries(data).filter(([, v]) => v !== undefined);
        if (entries.length === 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Provide at least one field to update."
            });
        }
    });
export const checkLeafLinkMatchSchema = z.object({
    refreshIfNoMatch: z.boolean().optional()
});
export const checkLeafLinkMarkPaidSchema = z.object({
    orderId: z.string().min(1).max(120).optional(),
    orderNumber: z.string().min(1).max(120).optional(),
    allowAmountOverride: z.boolean().optional(),
    /** Post this dollar amount to LeafLink (defaults to order outstanding). Required when one physical check pays multiple invoices. */
    paymentAmount: z.number().positive().max(10_000_000).optional(),
}).superRefine((data, ctx) => {
    if (!data.orderId && !data.orderNumber) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provide orderId or orderNumber.",
            path: ["orderId"]
        });
    }
});

/** Same body shapes as check LeafLink routes — cash incoming payments use LeafLink `Cash` method. */
export const cashLeafLinkMatchSchema = checkLeafLinkMatchSchema;
export const cashLeafLinkMarkPaidSchema = checkLeafLinkMarkPaidSchema;
const cashLogDepartmentSchema = z.enum(["CULTIVATION", "EXTRACTION", "PACKAGING", "GENERAL"]);
export const cashLogCreateSchema = z
    .object({
        direction: z.enum(["INCOMING", "OUTGOING"]),
        amount: z.number().positive().max(10_000_000),
        memo: z.string().max(500).optional(),
        entryDate: z.coerce.date().optional(),
        payeeCompany: z.string().max(200).optional(),
        invoiceNumber: z.string().max(4000).optional(),
        department: cashLogDepartmentSchema.optional(),
        /** Outgoing only: URL from POST /cash-log/upload-receipt. */
        receiptImageUrl: z.string().url().max(2000).optional()
    })
    .superRefine((data, ctx) => {
        if (data.direction === "INCOMING") {
            const pc = String(data.payeeCompany || "").trim();
            if (!pc) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "payeeCompany is required for incoming cash",
                    path: ["payeeCompany"]
                });
            }
            if (!data.entryDate) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "entryDate is required for incoming cash",
                    path: ["entryDate"]
                });
            }
            if (data.receiptImageUrl) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "receiptImageUrl is only allowed for outgoing cash",
                    path: ["receiptImageUrl"]
                });
            }
        }
        if (data.direction === "OUTGOING" && !data.department) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "department is required for outgoing cash",
                path: ["department"]
            });
        }
    });
export const cashLogUpdateSchema = z
    .object({
        amount: z.number().positive().max(10_000_000).optional(),
        memo: z.string().max(500).optional().nullable(),
        payeeCompany: z.string().max(200).optional().nullable(),
        invoiceNumber: z.string().max(4000).optional().nullable(),
        department: cashLogDepartmentSchema.optional().nullable(),
        entryDate: z.coerce.date().optional().nullable(),
        receiptImageUrl: z.union([z.string().url().max(2000), z.null()]).optional()
    })
    .superRefine((data, ctx) => {
        const n = Object.entries(data).filter(([, v]) => v !== undefined).length;
        if (n === 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Provide at least one field to update.",
                path: ["amount"]
            });
        }
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
    supplyUsed: z.string().max(200).optional(),
    extractionUiState: z.union([jsonRecordSchema, z.null()]).optional()
});
export const packagingLotUpdateSchema = z.object({
    sku: z.string().min(1).max(100).optional(),
    gramsPerUnit: z.number().positive().max(100).optional(),
    defaultTemplate: z.string().max(120).optional(),
    packagingUiState: z.union([jsonRecordSchema, z.null()]).optional()
});
export const taskLogCreateSchema = z.object({
    stage: z.enum(["CULTIVATION", "EXTRACTION", "PACKAGING", "EDIBLES"]),
    note: z.string().min(4).max(500),
    minutes: z.number().int().min(1).max(24 * 60),
    /** Cultivation cuid, dry-flower id, or display chain id (e.g. ACRO.YY-####) for filtering. */
    referenceId: z.string().min(1).max(200).optional()
});
export const laborEntryCreateSchema = z.object({
    stage: z.enum(["CULTIVATION", "EXTRACTION", "PACKAGING", "EDIBLES"]),
    taskType: z.string().min(2).max(64).default("CPU_OPERATIONAL_LABOR"),
    hours: z.number().positive().max(24),
    hourlyRate: z.number().positive().max(500),
    referenceId: z.string().cuid().optional(),
    cultivationBatchId: z.string().cuid().optional()
});
export const adminUserStatusSchema = z.object({
    isActive: z.boolean()
});
const adminUserUpdateRoleEnum = z.enum([
    "OWNER",
    "ADMIN",
    "OPERATIONS_MANAGER",
    "CULTIVATION_SPECIALIST",
    "EXTRACTION_SPECIALIST",
    "PACKAGING_SPECIALIST",
    "EDIBLES",
    "EDIBLES_MANAGER",
    "FACILITY_MAINTENANCE_SPECIALIST",
    "SALES_SPECIALIST",
    "FINANCIAL_ANALYST",
    "DATABASE_ARCHITECT",
    "FULL_STACK_DEVELOPER",
    "QA_TESTER",
    "VIEW_ONLY"
]);
const appPermissionIdSchema = z.enum([...ALL_APP_PERMISSION_IDS] as [string, ...string[]]);
export const adminUserUpdateSchema = z.preprocess(preprocessBodyNormalizeUserRole, z.object({
    email: z.string().email().optional(),
    role: adminUserUpdateRoleEnum.optional(),
    isActive: z.boolean().optional(),
    /** `null` clears overrides (role defaults). Omitted = do not change membership permissions. */
    appPermissions: z.array(appPermissionIdSchema).max(32).nullable().optional(),
    /** Per-employee EOD financial digest recipient toggle (defaults false when unset). */
    cashLogEodEnabled: z.boolean().optional(),
    /** Staff rewards program enrollment for this company membership. */
    rewardsEnrolled: z.boolean().optional(),
    /** Cultivation climate (Autogrow temp/RH) threshold alerts for this workspace. */
    cultivationAlertsEnabled: z.boolean().optional(),
    /** Colorado MED — Designated R-and-D Sampling Employee (Metrc). */
    designatedRnDSamplingEmployee: z.boolean().optional(),
}).superRefine((val, ctx) => {
    const n = [val.email, val.role, val.isActive, val.appPermissions, val.cashLogEodEnabled, val.rewardsEnrolled, val.cultivationAlertsEnabled, val.designatedRnDSamplingEmployee].filter((x) => x !== undefined).length;
    if (n === 0) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provide at least one field to update.",
            path: ["role"],
        });
    }
}));
const inviteCreateRoleEnum = z.enum([
    "ADMIN",
    "OPERATIONS_MANAGER",
    "CULTIVATION_SPECIALIST",
    "EXTRACTION_SPECIALIST",
    "PACKAGING_SPECIALIST",
    "EDIBLES",
    "EDIBLES_MANAGER",
    "FACILITY_MAINTENANCE_SPECIALIST",
    "SALES_SPECIALIST",
    "FINANCIAL_ANALYST",
    "DATABASE_ARCHITECT",
    "FULL_STACK_DEVELOPER",
    "QA_TESTER",
    "VIEW_ONLY"
]);
export const inviteCreateSchema = z.preprocess(preprocessBodyNormalizeUserRole, z.object({
    email: z.string().email(),
    role: inviteCreateRoleEnum
}));

const employeeSampleLicenseEnum = z.enum(["MEDICAL", "RETAIL"]);
const employeeSampleSourceEnum = z.enum(["CULTIVATION", "MANUFACTURING", "PACKAGING", "OTHER"]);
const employeeSampleCategoryEnum = z.enum(["FLOWER", "CONCENTRATE", "EDIBLE", "NON_EDIBLE_PRODUCT"]);
const employeeSampleUnitEnum = z.enum(["GRAMS", "SERVINGS", "EACH"]);
const employeeSamplePurposeEnum = z.enum(["QUALITY_CONTROL", "PRODUCT_DEVELOPMENT"]);

export const employeeSampleCreateSchema = z.object({
    employeeId: z.string().min(1).max(80),
    employeeIdentifierSnapshot: z.string().max(200).nullable().optional(),
    licenseType: employeeSampleLicenseEnum,
    sourceType: employeeSampleSourceEnum,
    productCategory: employeeSampleCategoryEnum,
    productName: z.string().min(1).max(500),
    batchNumber: z.string().min(1).max(200),
    metrcPackageTag: z.string().min(1).max(200),
    quantity: z.number().positive(),
    unit: employeeSampleUnitEnum,
    thcMgPerServing: z.number().nonnegative().nullable().optional(),
    transferDate: z.union([z.string().datetime({ offset: true }), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
    purpose: employeeSamplePurposeEnum,
    notes: z.string().max(8000).nullable().optional(),
    sopAcknowledged: z.literal(true),
    employeeConfirmedMonthlyLimit: z.literal(true),
    notCompensationAcknowledged: z.literal(true),
    noOnPremConsumptionAcknowledged: z.literal(true),
    noResaleOrTransferAcknowledged: z.literal(true),
});

export const employeeSampleListQuerySchema = z.object({
    employeeId: z.string().max(80).optional(),
    month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    productCategory: employeeSampleCategoryEnum.optional(),
    batchNumber: z.string().max(200).optional(),
    metrcTag: z.string().max(200).optional(),
    take: z.coerce.number().int().min(1).max(2000).optional(),
});

export const employeeSampleMonthlyUsageQuerySchema = z.object({
    employeeId: z.string().min(1).max(80),
    month: z.string().regex(/^\d{4}-\d{2}$/),
    licenseType: employeeSampleLicenseEnum,
    previewProductCategory: employeeSampleCategoryEnum.optional(),
    previewUnit: employeeSampleUnitEnum.optional(),
    previewQuantity: z.coerce.number().positive().optional(),
}).superRefine((v, ctx) => {
    const hasAny =
        v.previewProductCategory !== undefined ||
        v.previewUnit !== undefined ||
        v.previewQuantity !== undefined;
    if (hasAny) {
        if (!v.previewProductCategory || !v.previewUnit || v.previewQuantity === undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Provide previewProductCategory, previewUnit, and previewQuantity together for preview.",
                path: ["previewQuantity"],
            });
        }
    }
});

export const employeeSampleIdParam = z.object({
    id: z.string().min(1).max(80),
});

export const configUpsertSchema = z.object({
    key: z.string().min(2).max(100),
    value: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
});

/** Home notification bell inbox (per CompanyMembership, synced across devices). */
export const peerNotifyItemSchema = z.object({
    id: z.string().min(1).max(240),
    kind: z.enum(["task", "order", "climate"]),
    message: z.string().min(1).max(800),
    at: z.string().min(1).max(48),
    read: z.boolean(),
});
export const peerNotifyInboxPushSchema = z.object({
    item: peerNotifyItemSchema,
});
export const peerNotifyInboxReplaceSchema = z.object({
    items: z.array(peerNotifyItemSchema).max(60),
});

export const portalCompanyServicesPatchSchema = z.object({
    productionEnabled: z.boolean().optional(),
    salesSellerEnabled: z.boolean().optional(),
    salesBuyerEnabled: z.boolean().optional(),
    leafLinkInventorySyncEnabled: z.boolean().optional(),
});

const marketplaceAvailabilityEnum = z.enum(["AVAILABLE", "INTERNAL", "NOT_AVAILABLE"]);
const marketplaceImageDisplayModeEnum = z.enum(["AUTO", "CONTAIN", "COVER"]);

export const marketplaceSellerProductCreateSchema = z.object({
    name: z.string().min(1).max(500),
    description: z.string().max(8000).nullable().optional(),
    category: z.string().max(240).nullable().optional(),
    productType: z.string().max(240).nullable().optional(),
    strainName: z.string().max(240).nullable().optional(),
    flavorName: z.string().max(240).nullable().optional(),
    sku: z.string().max(240).nullable().optional(),
    unitSize: z.string().max(240).nullable().optional(),
    price: z.coerce.number().min(0),
    quantityAvailable: z.coerce.number().min(0),
    imageUrl: z.string().max(2000).nullable().optional(),
    imageDisplayMode: marketplaceImageDisplayModeEnum.nullable().optional(),
    potencyLabel: z.string().max(120).nullable().optional(),
    strainDominance: z.string().max(120).nullable().optional(),
    availabilityStatus: marketplaceAvailabilityEnum,
});

export const marketplaceSellerProductPatchSchema = marketplaceSellerProductCreateSchema.partial();

export const marketplaceOrderCreateSchema = z.object({
    sellerCompanyId: z.string().cuid(),
    notes: z.string().max(4000).nullable().optional(),
    lines: z
        .array(
            z.object({
                productId: z.string().cuid(),
                quantity: z.coerce.number().positive(),
            }),
        )
        .min(1)
        .max(80),
});

export const marketplaceSellerOrderStatusSchema = z.object({
    status: z.enum(["ACCEPTED", "REJECTED", "FULFILLED", "CANCELLED"]),
});

export const companyTenantLeafLinkSyncSchema = z.object({
    leafLinkInventorySyncEnabled: z.boolean(),
});

/** NexBatch direct messaging — start (or fetch) a 1:1 conversation between current company and one other company. */
export const messagingStartConversationSchema = z.object({
    companyId: z.string().cuid(),
});

/** NexBatch direct messaging — send a message into an existing conversation. */
export const messagingSendMessageSchema = z.object({
    body: z.string().trim().min(1).max(8000),
});

/** Server pages messages with `before` (cursor) for "load older" infinite scroll. */
export const messagingMessagesQuerySchema = z.object({
    before: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
});

/** Contact search box — `q` matches company name/slug, returns at most 25 active companies (excludes self). */
export const messagingContactsSearchSchema = z.object({
    q: z.string().trim().max(160).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const conversationIdParamSchema = z.object({
    conversationId: z.string().cuid(),
});

export const conversationMessageParamSchema = z.object({
    conversationId: z.string().cuid(),
    messageId: z.string().cuid(),
});

const usageProviderEnum = z.enum(["vercel", "railway", "neon", "resend", "cloudflare_r2", "ai"]);

/** NexBatch portal — manual vendor MTD total when vendor APIs do not return invoice USD (e.g. Neon console). */
export const vendorBillingManualOverrideSchema = z.object({
    provider: usageProviderEnum,
    /** Defaults to current UTC month (YYYY-MM). */
    month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    totalCostUsd: z.coerce.number().finite().min(0),
    billingPeriodStart: z.string().datetime().optional(),
    billingPeriodEnd: z.string().datetime().optional(),
    rawUsageJson: z.record(z.string(), z.unknown()).optional(),
});
