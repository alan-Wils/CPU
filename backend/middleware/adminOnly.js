function adminOnly(req, res, next) {
  const role = String(req.user?.role || "").toUpperCase();

  if (role !== "ADMIN") {
    return res.status(403).json({
      error: "Only Admin users can delete records",
    });
  }

  next();
}

module.exports = adminOnly;