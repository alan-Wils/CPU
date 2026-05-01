export function requireRole(allowedRoles) {
    return (req, res, next) => {
        if (!req.auth || !allowedRoles.includes(req.auth.role)) {
            res.status(403).json({ message: "Forbidden" });
            return;
        }
        next();
    };
}
