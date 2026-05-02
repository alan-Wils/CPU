import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { attachScopedCompanyId } from "./companyScope.js";
export function authMiddleware(req, res, next) {
    const authHeader = req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({ message: "Missing bearer token" });
        return;
    }
    const token = authHeader.slice("Bearer ".length);
    try {
        const payload = jwt.verify(token, env.JWT_SECRET) as Record<string, unknown>;
        if (!payload.sessionKind)
            payload.sessionKind = "company";
        if (payload.platformRole === undefined)
            payload.platformRole = null;
        req.auth = payload;
        attachScopedCompanyId(req);
        next();
    }
    catch {
        res.status(401).json({ message: "Invalid token" });
    }
}
