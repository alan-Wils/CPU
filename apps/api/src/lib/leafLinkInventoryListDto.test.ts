import { describe, expect, it } from "vitest";
import { leafLinkInventoryItemToListRow, leafLinkInventoryToListResponse } from "./leafLinkInventoryListDto.js";
import type { LeafLinkInventoryItem, LeafLinkInventoryResponse } from "../services/leaflinkService.js";

describe("leafLinkInventoryListDto", () => {
  it("omits imageUrl and heavy optional fields from list rows", () => {
    const item: LeafLinkInventoryItem = {
      id: "p1",
      productName: "Test",
      sku: "SKU",
      strain: "S",
      category: "Edibles",
      productType: "Gummy",
      subcategory: "Gummy",
      brand: "B",
      availableQuantity: 10,
      reservedQuantity: 2,
      totalQuantity: 12,
      unit: "each",
      packageSize: "10pk",
      price: 5,
      status: "Available",
      updatedAt: "2026-01-01T00:00:00.000Z",
      imageUrl: "https://cdn.example.com/very/long/path/to/image.jpg",
      sourcePackageGroup: "PKG-1",
      listingActive: true,
      wholesaleAvailable: true,
    };
    const row = leafLinkInventoryItemToListRow(item);
    expect(row).not.toHaveProperty("imageUrl");
    expect(row).not.toHaveProperty("reservedQuantity");
    expect(row.hasImage).toBe(true);
    expect(row.id).toBe("p1");
  });

  it("maps full response to compact list payload", () => {
    const full: LeafLinkInventoryResponse = {
      source: "leaflink",
      items: [
        {
          id: "a",
          productName: "A",
          sku: "",
          strain: "",
          category: "",
          productType: "",
          subcategory: "",
          brand: "",
          availableQuantity: 1,
          unit: "",
          packageSize: "",
          price: null,
          status: "",
          updatedAt: "",
          imageUrl: "",
          sourcePackageGroup: "",
        },
      ],
      stats: {
        totalSkus: 1,
        totalInventoryUnits: 1,
        totalInventoryValue: 0,
        categoriesCount: 0,
      },
      lastSyncedAt: "2026-01-01T00:00:00.000Z",
    };
    const list = leafLinkInventoryToListResponse(full);
    expect(list.items).toHaveLength(1);
    expect(list.stats.totalSkus).toBe(1);
    expect(list.source).toBe("leaflink");
  });
});
