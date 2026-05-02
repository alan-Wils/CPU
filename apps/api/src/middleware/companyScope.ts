import type { Request } from "express";

export type JwtAuthPayload = {
    userId: string;
    companyId: string;
    role: string;
};

function readQueryCompanyId(req: Request): string {
    const raw = req.query?.companyId;
    if (typeof raw === "string")
        return raw.trim();
    if (Array.isArray(raw) && typeof raw[0] === "string")
        return raw[0].trim();
    return "";
}

/**
 * Browser sends `X-Company-Id` for the UI-selected tenant (see root `lib/api.ts` `apiRequest`).
 * Some proxies strip custom headers on GET; for OWNER we also accept `?companyId=` (OWNER only).
 * Non-OWNER roles always use JWT `companyId` (ignore header/query — no cross-tenant impersonation).
 */
export function getScopedCompanyId(req: Request & { auth?: JwtAuthPayload }): string {
    const auth = req.auth;
    if (!auth)
        return "";
    const jwtCo = String(auth.companyId ?? "").trim();
    const header = String(req.header("x-company-id") ?? "").trim();
    const queryCo = readQueryCompanyId(req);
    if (auth.role === "OWNER") {
        if (header)
            return header;
        if (queryCo)
            return queryCo;
        return jwtCo;
    }
    return jwtCo;
}

export function attachScopedCompanyId(req: Request & { auth?: JwtAuthPayload }): void {
    (req as Request & { scopedCompanyId?: string }).scopedCompanyId = getScopedCompanyId(req);
}
