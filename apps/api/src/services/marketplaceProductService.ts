import type { MarketplaceProduct, MarketplaceProductAvailability, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { CompanyServiceSettingsService } from "./companyServiceSettingsService.js";

const settingsService = new CompanyServiceSettingsService();

export type MarketplaceProductWithLogo = MarketplaceProduct & {
  company?: { id: string; name: string; slug: string };
  companyInventoryLogoUrl?: string | null;
};

async function inventoryPrintLogoUrlByCompanyIds(companyIds: string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(companyIds.map((id) => String(id || "").trim()).filter(Boolean))];
  const map = new Map<string, string | null>();
  for (const id of unique) map.set(id, null);
  if (!unique.length) return map;
  const rows = await prisma.companyConfig.findMany({
    where: { companyId: { in: unique }, key: "sales" },
    select: { companyId: true, valueJson: true },
  });
  for (const row of rows) {
    let url: string | null = null;
    try {
      const v = JSON.parse(String(row.valueJson || "{}")) as { inventoryPrintLogoUrl?: unknown };
      const u = typeof v.inventoryPrintLogoUrl === "string" ? v.inventoryPrintLogoUrl.trim() : "";
      url = u || null;
    } catch {
      url = null;
    }
    map.set(row.companyId, url);
  }
  return map;
}

function assertNonNegativePriceQty(price: number, qty: number): void {
  if (!Number.isFinite(price) || price < 0) throw new AppError("Price must be zero or greater.", 400, "INVALID_PRICE");
  if (!Number.isFinite(qty) || qty < 0) throw new AppError("Quantity must be zero or greater.", 400, "INVALID_QUANTITY");
}

export type SellerProductListQuery = {
  search?: string;
  availabilityStatus?: string;
};

export type MarketplaceCatalogQuery = {
  buyerCompanyId: string;
  search?: string;
  /** Filter catalog to products from this seller company (query param `companyId`). */
  companyId?: string;
  category?: string;
  productType?: string;
  minPrice?: number;
  maxPrice?: number;
};

export type MarketplaceSellerRow = {
  id: string;
  name: string;
  slug: string;
  productCount: number;
};

export class MarketplaceProductService {
  async listForSeller(companyId: string, q: SellerProductListQuery): Promise<MarketplaceProductWithLogo[]> {
    await settingsService.getOrCreate(companyId);
    const where: Prisma.MarketplaceProductWhereInput = { companyId };
    const st = String(q.availabilityStatus || "").trim().toUpperCase();
    if (st === "AVAILABLE" || st === "INTERNAL" || st === "NOT_AVAILABLE") {
      where.availabilityStatus = st as MarketplaceProductAvailability;
    }
    const search = String(q.search || "").trim();
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { sku: { contains: search } },
        { description: { contains: search } },
      ];
    }
    const rows = await prisma.marketplaceProduct.findMany({
      where,
      orderBy: { updatedAt: "desc" },
    });
    const logoMap = await inventoryPrintLogoUrlByCompanyIds([companyId]);
    const companyInventoryLogoUrl = logoMap.get(companyId) ?? null;
    return rows.map((r) => ({ ...r, companyInventoryLogoUrl }));
  }

  async listMarketplaceCatalog(opts: MarketplaceCatalogQuery) {
    const buyerCompanyId = String(opts.buyerCompanyId || "").trim();
    const sellerIdsWithFlag = await prisma.companyServiceSettings.findMany({
      where: { salesSellerEnabled: true },
      select: { companyId: true },
    });
    const allowedSellerIds = new Set(sellerIdsWithFlag.map((r) => r.companyId));
    // Include the buyer's own company when they run Seller Side too, so they can preview how listings look
    // (orders from self are still rejected in MarketplaceOrderService).
    const sellerIdList = [...allowedSellerIds];
    if (sellerIdList.length === 0) return [];
    const where: Prisma.MarketplaceProductWhereInput = {
      availabilityStatus: "AVAILABLE",
      companyId: { in: sellerIdList },
    };
    const filterSellerId = String(opts.companyId || "").trim();
    if (filterSellerId) {
      if (!allowedSellerIds.has(filterSellerId)) return [];
      where.companyId = filterSellerId;
    }
    const search = String(opts.search || "").trim();
    if (search) {
      where.AND = [
        {
          OR: [
            { name: { contains: search } },
            { description: { contains: search } },
            { sku: { contains: search } },
          ],
        },
      ];
    }
    const cat = String(opts.category || "").trim();
    if (cat) where.category = { contains: cat };
    const pt = String(opts.productType || "").trim();
    if (pt) where.productType = { contains: pt };
    const priceFilter: Prisma.FloatFilter = {};
    if (typeof opts.minPrice === "number" && Number.isFinite(opts.minPrice)) priceFilter.gte = opts.minPrice;
    if (typeof opts.maxPrice === "number" && Number.isFinite(opts.maxPrice)) priceFilter.lte = opts.maxPrice;
    if (Object.keys(priceFilter).length) where.price = priceFilter;
    const rows = await prisma.marketplaceProduct.findMany({
      where,
      include: { company: { select: { id: true, name: true, slug: true } } },
      orderBy: { updatedAt: "desc" },
      take: 500,
    });
    const ids = rows.map((r) => r.companyId);
    const logoMap = await inventoryPrintLogoUrlByCompanyIds(ids);
    return rows.map((r) => ({
      ...r,
      companyInventoryLogoUrl: logoMap.get(r.companyId) ?? null,
    }));
  }

  async createManual(
    companyId: string,
    input: {
      name: string;
      description?: string | null;
      category?: string | null;
      productType?: string | null;
      strainName?: string | null;
      flavorName?: string | null;
      sku?: string | null;
      unitSize?: string | null;
      price: number;
      quantityAvailable: number;
      imageUrl?: string | null;
      imageDisplayMode?: string | null;
      potencyLabel?: string | null;
      strainDominance?: string | null;
      availabilityStatus: "AVAILABLE" | "INTERNAL" | "NOT_AVAILABLE";
    },
  ): Promise<MarketplaceProduct> {
    assertNonNegativePriceQty(input.price, input.quantityAvailable);
    return prisma.marketplaceProduct.create({
      data: {
        companyId,
        name: String(input.name || "").trim() || "Product",
        description: input.description ?? null,
        category: input.category ?? null,
        productType: input.productType ?? null,
        strainName: input.strainName ?? null,
        flavorName: input.flavorName ?? null,
        sku: input.sku ?? null,
        unitSize: input.unitSize ?? null,
        price: input.price,
        quantityAvailable: input.quantityAvailable,
        imageUrl: input.imageUrl ?? null,
        imageDisplayMode: input.imageDisplayMode ?? null,
        potencyLabel: input.potencyLabel ?? null,
        strainDominance: input.strainDominance ?? null,
        availabilityStatus: input.availabilityStatus,
        source: "MANUAL",
      },
    });
  }

  async updateSellerProduct(
    companyId: string,
    productId: string,
    input: Partial<{
      name: string;
      description: string | null;
      category: string | null;
      productType: string | null;
      strainName: string | null;
      flavorName: string | null;
      sku: string | null;
      unitSize: string | null;
      price: number;
      quantityAvailable: number;
      imageUrl: string | null;
      imageDisplayMode: string | null;
      potencyLabel: string | null;
      strainDominance: string | null;
      availabilityStatus: "AVAILABLE" | "INTERNAL" | "NOT_AVAILABLE";
    }>,
  ): Promise<MarketplaceProduct> {
    const p = await prisma.marketplaceProduct.findFirst({
      where: { id: productId, companyId },
    });
    if (!p) throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
    if (input.price !== undefined || input.quantityAvailable !== undefined) {
      assertNonNegativePriceQty(input.price ?? p.price, input.quantityAvailable ?? p.quantityAvailable);
    }
    const data: Prisma.MarketplaceProductUpdateInput = {};
    if (input.name !== undefined) data.name = String(input.name || "").trim() || p.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.category !== undefined) data.category = input.category;
    if (input.productType !== undefined) data.productType = input.productType;
    if (input.strainName !== undefined) data.strainName = input.strainName;
    if (input.flavorName !== undefined) data.flavorName = input.flavorName;
    if (input.sku !== undefined) data.sku = input.sku;
    if (input.unitSize !== undefined) data.unitSize = input.unitSize;
    if (input.price !== undefined) data.price = input.price;
    if (input.quantityAvailable !== undefined) data.quantityAvailable = input.quantityAvailable;
    if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl;
    if (input.imageDisplayMode !== undefined) data.imageDisplayMode = input.imageDisplayMode;
    if (input.potencyLabel !== undefined) data.potencyLabel = input.potencyLabel;
    if (input.strainDominance !== undefined) data.strainDominance = input.strainDominance;
    if (input.availabilityStatus !== undefined) data.availabilityStatus = input.availabilityStatus;
    return prisma.marketplaceProduct.update({
      where: { id: p.id },
      data,
    });
  }

  async deleteSellerProduct(companyId: string, productId: string): Promise<void> {
    const p = await prisma.marketplaceProduct.findFirst({
      where: { id: productId, companyId },
    });
    if (!p) throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
    await prisma.marketplaceProduct.delete({ where: { id: p.id } });
  }

  async getByIdForCompany(companyId: string, productId: string): Promise<MarketplaceProduct | null> {
    return prisma.marketplaceProduct.findFirst({
      where: { id: productId, companyId },
    });
  }

  /** Single seller product with `companyInventoryLogoUrl` for API responses. */
  async getSellerProductWithLogo(companyId: string, productId: string): Promise<MarketplaceProductWithLogo | null> {
    const row = await prisma.marketplaceProduct.findFirst({
      where: { id: productId, companyId },
    });
    if (!row) return null;
    const logoMap = await inventoryPrintLogoUrlByCompanyIds([companyId]);
    return { ...row, companyInventoryLogoUrl: logoMap.get(companyId) ?? null };
  }

  async listMarketplaceSellers(buyerCompanyId: string): Promise<MarketplaceSellerRow[]> {
    const products = await this.listMarketplaceCatalog({ buyerCompanyId });
    const map = new Map<string, MarketplaceSellerRow>();
    for (const p of products) {
      const c = p.company;
      const row = map.get(c.id) || { id: c.id, name: c.name, slug: c.slug, productCount: 0 };
      row.productCount += 1;
      map.set(c.id, row);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async getAvailableForOrder(productId: string, sellerCompanyId: string): Promise<MarketplaceProduct | null> {
    const settings = await settingsService.getOrCreate(sellerCompanyId);
    if (!settings.salesSellerEnabled) return null;
    return prisma.marketplaceProduct.findFirst({
      where: {
        id: productId,
        companyId: sellerCompanyId,
        availabilityStatus: "AVAILABLE",
      },
    });
  }
}
