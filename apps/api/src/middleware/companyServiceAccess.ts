import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/AppError.js";
import { getScopedCompanyId } from "./companyScope.js";
import { CompanyServiceSettingsService } from "../services/companyServiceSettingsService.js";

const settingsService = new CompanyServiceSettingsService();

export type CompanyServiceFlagKey = "salesSellerEnabled" | "salesBuyerEnabled";

export function requireCompanyService(flag: CompanyServiceFlagKey) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const companyId = getScopedCompanyId(req);
      if (!companyId) {
        res.status(403).json({ message: "Select a company to continue", code: "COMPANY_REQUIRED" });
        return;
      }
      const s = await settingsService.getOrCreate(companyId);
      if (!s[flag]) {
        throw new AppError("This workspace does not have access to this feature.", 403, "SERVICE_DISABLED");
      }
      next();
    } catch (e) {
      if (e instanceof AppError) {
        res.status(e.statusCode).json({ message: e.message, code: e.code });
        return;
      }
      next(e);
    }
  };
}
