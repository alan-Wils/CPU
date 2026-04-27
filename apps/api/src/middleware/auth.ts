import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";
import type { AuthContext } from "../types.js";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ message: "Missing bearer token" });
    return;
  }

  const token = authHeader.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthContext;
    req.auth = payload;
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
}
