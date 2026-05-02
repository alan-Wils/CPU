import type { NexBatchCompanyRole, NexBatchPlatformRole, UserRole } from "@prisma/client";

const LEGACY_TO_COMPANY: Record<UserRole, NexBatchCompanyRole> = {
    OWNER: "owner",
    ADMIN: "admin",
    OPERATIONS_MANAGER: "management",
    CULTIVATION_SPECIALIST: "grow_staff",
    EXTRACTION_SPECIALIST: "extraction_staff",
    PACKAGING_SPECIALIST: "packaging_staff",
    FINANCIAL_ANALYST: "lead_staff",
    DATABASE_ARCHITECT: "lead_staff",
    FULL_STACK_DEVELOPER: "lead_staff",
    QA_TESTER: "lead_staff",
    VIEW_ONLY: "grow_staff",
};

const COMPANY_TO_LEGACY: Record<NexBatchCompanyRole, UserRole> = {
    owner: "OWNER",
    admin: "ADMIN",
    management: "OPERATIONS_MANAGER",
    lead_staff: "OPERATIONS_MANAGER",
    grow_staff: "CULTIVATION_SPECIALIST",
    extraction_staff: "EXTRACTION_SPECIALIST",
    packaging_staff: "PACKAGING_SPECIALIST",
    trimming_staff: "CULTIVATION_SPECIALIST",
};

export function legacyUserRoleToCompanyRole(role: UserRole): NexBatchCompanyRole {
    return LEGACY_TO_COMPANY[role] ?? "lead_staff";
}

export function companyRoleToLegacyRbac(role: NexBatchCompanyRole): UserRole {
    return COMPANY_TO_LEGACY[role] ?? "OPERATIONS_MANAGER";
}

/** NexBatch platform operators act as OWNER inside an allowed company for legacy RBAC checks. */
export function platformRoleToLegacyRbac(role: NexBatchPlatformRole | null | undefined): UserRole {
    if (!role)
        return "VIEW_ONLY";
    if (role === "nexbatch_admin" || role === "owner")
        return "OWNER";
    if (role === "admin")
        return "ADMIN";
    if (role === "management" || role === "lead_staff")
        return "OPERATIONS_MANAGER";
    if (role === "grow_staff")
        return "CULTIVATION_SPECIALIST";
    if (role === "extraction_staff")
        return "EXTRACTION_SPECIALIST";
    if (role === "packaging_staff")
        return "PACKAGING_SPECIALIST";
    if (role === "trimming_staff")
        return "CULTIVATION_SPECIALIST";
    return "VIEW_ONLY";
}

export function isPlatformOperator(role: NexBatchPlatformRole | null | undefined): boolean {
    return Boolean(role);
}
