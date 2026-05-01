function canDeleteLogs(req, res, next) {
  const role = String(req.user?.role || "").toUpperCase();

  if (!["OWNER", "ADMIN"].includes(role)) {
    return res.status(403).json({
      error: "Only Owner or Admin users can delete logs",
    });
  }

  next();
}

module.exports = canDeleteLogs;