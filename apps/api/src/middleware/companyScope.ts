import type { Request } from "express";

export type JwtAuthPayload = {
    userId: string;
    /** Active workspace company (JWT only — never trust client headers). */
    companyId: string;
    /** Legacy RBAC role for the active company context (`UserRole` string). */
    role: string;
    sessionKind?: "company" | "portal";
    platformRole?: string | null;
    /** Effective app permission ids (server-normalized). */
    permissions?: string[];
};

/**
 * Active tenant id from JWT. Client `X-Company-Id` is ignored to prevent cross-tenant access.
 * Portal users re-issue JWT via `/api/auth/select-company` when switching tenants.
 */
export function getScopedCompanyId(req: Request & { auth?: JwtAuthPayload }): string {
    const auth = req.auth;
    if (!auth)
        return "";
    return String(auth.companyId ?? "").trim();
}

export function attachScopedCompanyId(req: Request & { auth?: JwtAuthPayload }): void {
    (req as Request & { scopedCompanyId?: string }).scopedCompanyId = getScopedCompanyId(req);
}
