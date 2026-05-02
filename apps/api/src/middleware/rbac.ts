export function requireRole(allowedRoles) {
    return (req, res, next) => {
        if (!req.auth || !allowedRoles.includes(req.auth.role)) {
            res.status(403).json({ message: "Forbidden" });
            return;
        }
        next();
    };
}

export function requirePlatformRoles(allowedPlatformRoles: string[]) {
    return (req, res, next) => {
        const pr = String((req.auth as { platformRole?: string | null })?.platformRole || "");
        if (!req.auth || !allowedPlatformRoles.includes(pr)) {
            res.status(403).json({ message: "Forbidden" });
            return;
        }
        next();
    };
}

/**
 * Allows NexBatch platform roles to act on any `companyId` route param, or a
 * company OWNER only when their JWT tenant matches that same company (prevents
 * cross-tenant PATCH by ID).
 */
export function requireCompanyOwnerOfTargetOrPlatform(req, res, next) {
    const pr = String(req.auth?.platformRole || "");
    if (pr === "nexbatch_admin" || pr === "owner") {
        next();
        return;
    }
    const paramId = String(req.params?.companyId || "").trim();
    const jwtCompany = String(req.auth?.companyId || "").trim();
    if (req.auth?.role === "OWNER" && paramId && jwtCompany === paramId) {
        next();
        return;
    }
    res.status(403).json({ message: "Forbidden" });
}
