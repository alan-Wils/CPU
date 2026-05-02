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
