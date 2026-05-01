const jwt = require("jsonwebtoken");

/** Must match signing secret in backend/routes/auth.js `createToken`. */
function jwtSecret() {
  return process.env.JWT_SECRET || "dev_secret_change_this";
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret());
    if (!decoded || typeof decoded !== "object") {
      return res.status(401).json({ error: "Invalid token payload" });
    }
    const { userId, companyId } = decoded;
    if (!userId || !companyId) {
      return res.status(401).json({ error: "Invalid token payload" });
    }
    req.user = decoded;
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = authRequired;