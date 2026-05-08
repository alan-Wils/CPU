import type { CompanyServiceSettings } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";

export type CompanyServiceSettingsDto = {
  productionEnabled: boolean;
  salesSellerEnabled: boolean;
  salesBuyerEnabled: boolean;
  leafLinkInventorySyncEnabled: boolean;
};

function toDto(row: CompanyServiceSettings): CompanyServiceSettingsDto {
  return {
    productionEnabled: row.productionEnabled,
    salesSellerEnabled: row.salesSellerEnabled,
    salesBuyerEnabled: row.salesBuyerEnabled,
    leafLinkInventorySyncEnabled: row.leafLinkInventorySyncEnabled,
  };
}

export class CompanyServiceSettingsService {
  async getOrCreate(companyId: string): Promise<CompanyServiceSettingsDto> {
    const cid = String(companyId || "").trim();
    if (!cid) throw new AppError("Company id required", 400, "COMPANY_ID_REQUIRED");
    const existing = await prisma.companyServiceSettings.findUnique({ where: { companyId: cid } });
    if (existing) return toDto(existing);
    const created = await prisma.companyServiceSettings.create({
      data: { companyId: cid },
    });
    return toDto(created);
  }

  async assertCompanyExists(companyId: string): Promise<void> {
    const cid = String(companyId || "").trim();
    const c = await prisma.company.findUnique({ where: { id: cid }, select: { id: true } });
    if (!c) throw new AppError("Company not found", 404, "COMPANY_NOT_FOUND");
  }

  async updateForPortal(companyId: string, patch: Partial<CompanyServiceSettingsDto>): Promise<CompanyServiceSettingsDto> {
    await this.assertCompanyExists(companyId);
    await this.getOrCreate(companyId);
    const current = await prisma.companyServiceSettings.findUniqueOrThrow({ where: { companyId } });
    let productionEnabled = current.productionEnabled;
    let salesSellerEnabled = current.salesSellerEnabled;
    let salesBuyerEnabled = current.salesBuyerEnabled;
    let leafLinkInventorySyncEnabled = current.leafLinkInventorySyncEnabled;
    if (typeof patch.productionEnabled === "boolean") productionEnabled = patch.productionEnabled;
    if (typeof patch.salesSellerEnabled === "boolean") salesSellerEnabled = patch.salesSellerEnabled;
    if (typeof patch.salesBuyerEnabled === "boolean") salesBuyerEnabled = patch.salesBuyerEnabled;
    if (typeof patch.leafLinkInventorySyncEnabled === "boolean")
      leafLinkInventorySyncEnabled = patch.leafLinkInventorySyncEnabled;
    if (!salesSellerEnabled) leafLinkInventorySyncEnabled = false;
    const updated = await prisma.companyServiceSettings.update({
      where: { companyId },
      data: {
        productionEnabled,
        salesSellerEnabled,
        salesBuyerEnabled,
        leafLinkInventorySyncEnabled,
      },
    });
    return toDto(updated);
  }

  async getRaw(companyId: string): Promise<CompanyServiceSettings> {
    await this.getOrCreate(companyId);
    return prisma.companyServiceSettings.findUniqueOrThrow({ where: { companyId } });
  }

  /** Company admins may toggle LeafLink → marketplace sync when Seller Side is on. */
  async updateLeafLinkInventorySyncForTenant(
    companyId: string,
    leafLinkInventorySyncEnabled: boolean,
  ): Promise<CompanyServiceSettingsDto> {
    await this.getOrCreate(companyId);
    const current = await prisma.companyServiceSettings.findUniqueOrThrow({ where: { companyId } });
    if (!current.salesSellerEnabled) {
      throw new AppError("Enable Seller Side (via NexBatch portal) before LeafLink inventory sync.", 403, "SALES_SELLER_REQUIRED");
    }
    const row = await prisma.companyServiceSettings.update({
      where: { companyId },
      data: { leafLinkInventorySyncEnabled },
    });
    return toDto(row);
  }
}
