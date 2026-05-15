import type { NexBatchCompanyRole, NexBatchPlatformRole, UserRole } from "@prisma/client";

const LEGACY_TO_COMPANY: Record<UserRole, NexBatchCompanyRole> = {
    OWNER: "owner",
    ADMIN: "admin",
    OPERATIONS_MANAGER: "management",
    CULTIVATION_SPECIALIST: "grow_staff",
    EXTRACTION_SPECIALIST: "extraction_staff",
    PACKAGING_SPECIALIST: "packaging_staff",
    EDIBLES: "lead_staff",
    EDIBLES_MANAGER: "management",
    FINANCIAL_ANALYST: "lead_staff",
    DATABASE_ARCHITECT: "lead_staff",
    FULL_STACK_DEVELOPER: "lead_staff",
    QA_TESTER: "lead_staff",
    VIEW_ONLY: "grow_staff",
    FACILITY_MAINTENANCE_SPECIALIST: "lead_staff",
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

/** Matches `POST /companies` — only these platform roles bootstrap new tenants. */
export function canCreateCompanyAsPlatform(role: NexBatchPlatformRole | string | null | undefined): boolean {
    return role === "nexbatch_admin" || role === "owner";
}

/** Owner, NexBatch Admin, and NexBatch Staff (`admin`) see every company in the portal company picker. */
export function canSeeAllCompaniesAsPlatform(role: NexBatchPlatformRole | string | null | undefined): boolean {
    const r = String(role || "").trim();
    return r === "owner" || r === "nexbatch_admin" || r === "admin";
}

/** May list / invite / edit NexBatch portal staff (not the same as creating new tenants). */
export function canManageNexBatchPortalStaff(role: NexBatchPlatformRole | string | null | undefined): boolean {
    return canSeeAllCompaniesAsPlatform(role);
}

/** Portal “Add NexBatch staff” UI tiers → stored `NexBatchPlatformRole` (`staff` → `admin`). */
export type NexBatchInviteUiTier = "owner" | "nexbatch_admin" | "management" | "staff";

/** User-facing denial reason when the actor cannot assign this portal invite tier (`null` = allowed). */
export function nexbatchPortalInviteTierViolatesPolicy(
    actorPlatformRole: string | null | undefined,
    tier: NexBatchInviteUiTier,
): string | null {
    const pr = String(actorPlatformRole || "").trim();
    if (pr !== "owner" && pr !== "nexbatch_admin" && pr !== "admin") {
        return "Forbidden";
    }
    if (tier === "owner" && pr !== "owner") {
        return "Only a NexBatch owner account can invite someone as Owner (full platform).";
    }
    if (pr === "admin" && tier !== "nexbatch_admin" && tier !== "staff") {
        return "NexBatch Staff managers may only invite NexBatch Admin or NexBatch Staff tiers.";
    }
    return null;
}

/** Validates changing an existing user's portal tier similarly to invites. */
export function nexbatchPortalTierChangeViolatesPolicy(
    actorPlatformRole: string | null | undefined,
    tier: NexBatchInviteUiTier,
): string | null {
    return nexbatchPortalInviteTierViolatesPolicy(actorPlatformRole, tier);
}

/** NexBatchCompanyRole granted when attaching portal operators to workspaces (matches accept-invite bootstrap). */
export function companyMembershipRoleForPlatformOperator(): "owner" {
    return "owner";
}

export function nexBatchInviteTierToPlatformRole(tier: NexBatchInviteUiTier): NexBatchPlatformRole {
    if (tier === "owner")
        return "owner";
    if (tier === "nexbatch_admin")
        return "nexbatch_admin";
    if (tier === "management")
        return "management";
    if (tier === "staff")
        return "admin";
    throw new Error(`Invalid NexBatch invite tier: ${tier}`);
}

/** Stored platform role -> portal UI tier. */
export function platformRoleToNexBatchInviteUiTier(role: NexBatchPlatformRole | string): NexBatchInviteUiTier {
    const r = String(role || "").trim();
    if (r === "owner")
        return "owner";
    if (r === "nexbatch_admin")
        return "nexbatch_admin";
    if (r === "management")
        return "management";
    return "staff";
}

/** Human label for invite email / UI copy. */
export function nexBatchPlatformRoleInviteLabel(role: NexBatchPlatformRole | string): string {
    const r = String(role || "").trim();
    if (r === "owner")
        return "Owner (full platform)";
    if (r === "nexbatch_admin")
        return "NexBatch Admin";
    if (r === "management")
        return "Management";
    if (r === "admin")
        return "NexBatch Staff";
    return r || "NexBatch portal";
}
