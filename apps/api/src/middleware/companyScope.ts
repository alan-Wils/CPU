import type { Request } from "express";

export type JwtAuthPayload = {
    userId: string;
    companyId: string;
    role: string;
};

/**
 * Browser sends `X-Company-Id` for the UI-selected tenant (see root `lib/api.ts` `apiRequest`).
 * OWNER may operate across companies; other roles stay on JWT `companyId` (ignore forged headers).
 */
export function getScopedCompanyId(req: Request & { auth?: JwtAuthPayload }): string {
    const auth = req.auth;
    if (!auth)
        return "";
    const jwtCo = String(auth.companyId ?? "").trim();
    const header = String(req.header("x-company-id") ?? "").trim();
    if (auth.role === "OWNER" && header)
        return header;
    return jwtCo;
}

export function attachScopedCompanyId(req: Request & { auth?: JwtAuthPayload }): void {
    (req as Request & { scopedCompanyId?: string }).scopedCompanyId = getScopedCompanyId(req);
}
