import type { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { LeafLinkInventoryService } from "./leaflinkService.js";
import { CompanyServiceSettingsService } from "./companyServiceSettingsService.js";

const inventoryService = new LeafLinkInventoryService();
const settingsService = new CompanyServiceSettingsService();

/**
 * Pulls LeafLink inventory via existing credentials and upserts `MarketplaceProduct` rows.
 * Preserves `availabilityStatus` on existing rows; does not overwrite price/description/image on update.
 */
export async function syncLeafLinkInventoryToMarketplaceProducts(
  companyId: string,
  actorUserId: string | undefined,
): Promise<{ upserted: number; created: number; updated: number }> {
  const settings = await settingsService.getRaw(companyId);
  if (!settings.salesSellerEnabled)
    throw new AppError("Seller side is not enabled for this company.", 403, "SALES_SELLER_DISABLED");
  if (!settings.leafLinkInventorySyncEnabled)
    throw new AppError("LeafLink inventory sync is not enabled.", 403, "LEAFLINK_MARKETPLACE_SYNC_DISABLED");

  const pull = await inventoryService.fetchAvailableInventory(companyId, {
    refresh: true,
    actorUserId: actorUserId || "system",
  });

  let created = 0;
  let updated = 0;
  for (const item of pull.items) {
    const leafKey = String(item.id || "").trim();
    if (!leafKey) continue;
    const existing = await prisma.marketplaceProduct.findFirst({
      where: { companyId, leafLinkInventoryId: leafKey },
    });
    const descParts = [item.subcategory, item.brand].filter(Boolean).join(" · ");
    const description = descParts || null;
    const unitSize = [item.packageSize, item.unit].filter(Boolean).join(" ").trim() || null;
    if (!existing) {
      await prisma.marketplaceProduct.create({
        data: {
          companyId,
          name: item.productName || "LeafLink product",
          description,
          category: item.category || null,
          productType: item.productType || null,
          strainName: item.strain || null,
          flavorName: null,
          sku: item.sku || null,
          unitSize,
          price: item.price ?? 0,
          quantityAvailable: item.availableQuantity,
          imageUrl: item.imageUrl || null,
          availabilityStatus: "INTERNAL",
          source: "LEAFLINK",
          leafLinkInventoryId: leafKey,
          leafLinkRawJson: item as unknown as Prisma.InputJsonValue,
        },
      });
      created += 1;
      continue;
    }
    await prisma.marketplaceProduct.update({
      where: { id: existing.id },
      data: {
        name: item.productName || existing.name,
        category: item.category ?? existing.category,
        productType: item.productType ?? existing.productType,
        strainName: item.strain || existing.strainName,
        quantityAvailable: item.availableQuantity,
        leafLinkRawJson: item as unknown as Prisma.InputJsonValue,
        sku: item.sku ?? existing.sku,
        unitSize: unitSize ?? existing.unitSize,
      },
    });
    updated += 1;
  }
  return { upserted: created + updated, created, updated };
}
