import type { Request, Response, NextFunction } from "express";
import type { AppRole } from "../types.js";

export function requireRole(allowedRoles: AppRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth || !allowedRoles.includes(req.auth.role)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    next();
  };
}
