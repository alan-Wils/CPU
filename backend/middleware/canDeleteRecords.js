function canDeleteRecords(req, res, next) {
  const role = String(req.user?.role || "").toUpperCase();

  if (!["OWNER", "ADMIN", "MANAGER"].includes(role)) {
    return res.status(403).json({
      error: "Only Owner, Admin, or Manager users can delete records",
    });
  }

  next();
}

module.exports = canDeleteRecords;