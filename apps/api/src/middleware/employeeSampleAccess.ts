import type { NextFunction, Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { getScopedCompanyId, type JwtAuthPayload } from "./companyScope.js";

/**
 * Colorado employee R&D samples: Owner, Company Admin, workspace Management (NexBatchCompanyRole `management`),
 * or NexBatch platform admins acting with OWNER JWT.
 * Excludes `lead_staff` and other memberships that map to legacy OPERATIONS_MANAGER but are not true management.
 */
export async function requireEmployeeSampleAccess(
    req: Request & { auth?: JwtAuthPayload },
    res: Response,
    next: NextFunction,
): Promise<void> {
    const auth = req.auth;
    if (!auth) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }
    const role = String(auth.role || "").trim().toUpperCase();
    if (role === "OWNER" || role === "ADMIN") {
        next();
        return;
    }
    if (role !== "OPERATIONS_MANAGER") {
        res.status(403).json({ message: "Forbidden" });
        return;
    }
    const companyId = getScopedCompanyId(req);
    if (!companyId) {
        res.status(403).json({ message: "Forbidden" });
        return;
    }
    const m = await prisma.companyMembership.findFirst({
        where: { userId: auth.userId, companyId },
        select: { role: true },
    });
    if (m?.role === "management") {
        next();
        return;
    }
    res.status(403).json({ message: "Forbidden" });
}
