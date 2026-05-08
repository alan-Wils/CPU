import { canManageNexBatchPortalStaff } from "../lib/nexbatchRoles.js";

export function requireRole(allowedRoles) {
    return (req, res, next) => {
        if (!req.auth || !allowedRoles.includes(req.auth.role)) {
            res.status(403).json({ message: "Forbidden" });
            return;
        }
        next();
    };
}

/** Allows legacy roles **or** a granular JWT permission (e.g. `workflow.delete`). */
export function requireRoleOrAppPermission(allowedRoles: string[], permission: string) {
    return (req, res, next) => {
        const role = req.auth?.role;
        if (role && allowedRoles.includes(role)) {
            next();
            return;
        }
        const perms = (req.auth as { permissions?: string[] } | undefined)?.permissions;
        if (Array.isArray(perms) && perms.includes(permission)) {
            next();
            return;
        }
        res.status(403).json({ message: "Forbidden" });
    };
}

/** Portal operators who may list/invite NexBatch platform staff (`owner`, `nexbatch_admin`, `admin`). */
export function requireNexBatchStaffManagers(req, res, next) {
    const pr = String((req.auth as { platformRole?: string | null })?.platformRole || "").trim();
    if (!canManageNexBatchPortalStaff(pr)) {
        res.status(403).json({ message: "Forbidden" });
        return;
    }
    next();
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
