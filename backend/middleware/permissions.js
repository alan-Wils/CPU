const ROLE_LEVELS = {
  VIEW_ONLY: 1,
  CULTIVATION: 2,
  EXTRACTION: 2,
  PACKAGING: 2,
  MANAGER: 3,
  ADMIN: 4,
  OWNER: 5,
};

function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    const userRole = req.user?.role;

    if (!userRole) {
      return res.status(403).json({ error: "Missing user role" });
    }

    if (allowedRoles.includes(userRole)) {
      return next();
    }

    return res.status(403).json({ error: "Access denied" });
  };
}

function requireMinimumRole(minimumRole) {
  return (req, res, next) => {
    const userRole = req.user?.role;

    if (!userRole) {
      return res.status(403).json({ error: "Missing user role" });
    }

    const userLevel = ROLE_LEVELS[userRole] || 0;
    const minimumLevel = ROLE_LEVELS[minimumRole] || 0;

    if (userLevel >= minimumLevel) {
      return next();
    }

    return res.status(403).json({ error: "Access denied" });
  };
}

module.exports = {
  ROLE_LEVELS,
  requireRole,
  requireMinimumRole,
};