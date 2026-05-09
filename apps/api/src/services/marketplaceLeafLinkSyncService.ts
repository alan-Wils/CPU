import type { MarketplaceProductAvailability, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { LeafLinkInventoryService } from "./leaflinkService.js";
import { CompanyServiceSettingsService } from "./companyServiceSettingsService.js";

const inventoryService = new LeafLinkInventoryService();
const settingsService = new CompanyServiceSettingsService();

/** Optional booleans parsed from LeafLink inventory rows (`is_active`, `available_for_wholesale`, nested `listing`, …). */
export type LeafLinkListingSignals = {
  listingActive?: boolean;
  wholesaleAvailable?: boolean;
};

/**
 * Maps LeafLink listing-style `status` (see inventory normalizer: status / availability / listing_state, …)
 * into NexBatch marketplace availability. Checks `unavailable` before `available` because the former contains the latter as a substring.
 *
 * **Wholesale rule:** If LeafLink marks the row active / wholesale-available and there is stock, NexBatch uses `AVAILABLE`
 * so buyers can purchase. LeafLink “Internal” visibility with inventory is treated as sellable unless status is a hard negative.
 */
export function marketplaceAvailabilityFromLeafLinkStatus(
  leafStatus: string,
  availableQuantity: number,
  signals?: LeafLinkListingSignals,
): MarketplaceProductAvailability {
  const s = String(leafStatus || "").trim().toLowerCase().replace(/\s+/g, " ");
  const qty = Number(availableQuantity);
  const inStock = Number.isFinite(qty) && qty > 0;

  if (
    s.includes("unavailable") ||
    s.includes("not available") ||
    s.includes("archived") ||
    s.includes("inactive") ||
    s.includes("discontinued") ||
    s.includes("deleted")
  ) {
    return "NOT_AVAILABLE";
  }
  if (s.includes("out of stock") || s.includes("out_of_stock")) {
    return "NOT_AVAILABLE";
  }

  if (inStock && (signals?.listingActive === true || signals?.wholesaleAvailable === true)) {
    return "AVAILABLE";
  }

  if (s.includes("draft") || s.includes("pending") || s.includes("hidden")) {
    return "INTERNAL";
  }

  // LeafLink “internal” listing visibility: still offer on NexBatch when there is inventory to ship.
  if (s.includes("internal")) {
    if (inStock) return "AVAILABLE";
    return "INTERNAL";
  }

  if (
    s.includes("available") ||
    s === "live" ||
    s.includes("active") ||
    s.includes("published") ||
    s.includes("listed")
  ) {
    return "AVAILABLE";
  }

  if (signals?.listingActive === false && !inStock) {
    return "NOT_AVAILABLE";
  }

  if (!Number.isFinite(qty) || qty <= 0) {
    return "NOT_AVAILABLE";
  }
  return "AVAILABLE";
}

/**
 * Pulls LeafLink inventory via existing credentials and upserts `MarketplaceProduct` rows.
 * Sets `availabilityStatus` from LeafLink listing state on every sync (create + update).
 * Updates `imageUrl` from LeafLink when the API provides a photo URL; leaves existing NxB uploads intact when LeafLink sends no image.
 * Does not overwrite price or description on update (existing behavior).
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
    const availabilityStatus = marketplaceAvailabilityFromLeafLinkStatus(item.status, item.availableQuantity, {
      listingActive: item.listingActive,
      wholesaleAvailable: item.wholesaleAvailable,
    });
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
          availabilityStatus,
          source: "LEAFLINK",
          leafLinkInventoryId: leafKey,
          leafLinkRawJson: item as unknown as Prisma.InputJsonValue,
        },
      });
      created += 1;
      continue;
    }
    const leafImage = String(item.imageUrl || "").trim();
    await prisma.marketplaceProduct.update({
      where: { id: existing.id },
      data: {
        name: item.productName || existing.name,
        category: item.category ?? existing.category,
        productType: item.productType ?? existing.productType,
        strainName: item.strain || existing.strainName,
        quantityAvailable: item.availableQuantity,
        availabilityStatus,
        leafLinkRawJson: item as unknown as Prisma.InputJsonValue,
        sku: item.sku ?? existing.sku,
        unitSize: unitSize ?? existing.unitSize,
        ...(leafImage ? { imageUrl: leafImage } : {}),
      },
    });
    updated += 1;
  }
  return { upserted: created + updated, created, updated };
}
