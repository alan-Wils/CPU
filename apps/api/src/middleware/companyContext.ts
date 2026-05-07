import type { NextFunction, Request, Response } from "express";
import { getScopedCompanyId, type JwtAuthPayload } from "./companyScope.js";
import { TenantRepository } from "../repositories/TenantRepository.js";

const repo = new TenantRepository();

function routeKey(req: Request): { method: string; path: string } {
    const method = String(req.method || "GET").toUpperCase();
    const path = `${req.baseUrl || ""}${req.path || ""}`.replace(/\/+/g, "/") || "/";
    return { method, path };
}

/**
 * Routes that may run without an active `companyId` on the JWT (portal, pre-selector).
 */
function allowsMissingCompany(req: Request): boolean {
    const { method, path } = routeKey(req);
    if (method === "GET" && /\/companies\/accessible$/.test(path))
        return true;
    if (method === "POST" && /\/companies$/.test(path))
        return true;
    if (method === "POST" && /\/nexbatch\/staff\/invite$/.test(path))
        return true;
    /** NexBatch portal: usage/cost modal calls without an active tenant JWT company id. */
    if (method === "GET" && /\/admin\/companies\/[^/]+\/usage-costs$/.test(path))
        return true;
    if (method === "GET" && /\/admin\/companies\/[^/]+\/nexbatch-company-usage-log$/.test(path))
        return true;
    if (method === "POST" && /\/admin\/usage-costs\/sync$/.test(path))
        return true;
    return false;
}

/**
 * Ensures every scoped API call has a tenant, and that tenant matches a CompanyMembership
 * (no header/query spoofing — company id comes only from the JWT).
 */
export async function companyContextMiddleware(req: Request & { auth?: JwtAuthPayload }, res: Response, next: NextFunction): Promise<void> {
    const auth = req.auth;
    if (!auth) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }
    const companyId = getScopedCompanyId(req);
    if (!companyId) {
        if (allowsMissingCompany(req)) {
            next();
            return;
        }
        res.status(403).json({
            message: "Select a company to continue",
            code: "COMPANY_REQUIRED",
        });
        return;
    }
    const ok = await repo.db.companyMembership.findFirst({
        where: { userId: auth.userId, companyId },
        select: { id: true },
    });
    if (!ok) {
        res.status(403).json({ message: "No access to this company", code: "COMPANY_FORBIDDEN" });
        return;
    }
    next();
}
