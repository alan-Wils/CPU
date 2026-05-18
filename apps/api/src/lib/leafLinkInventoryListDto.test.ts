import { describe, expect, it } from "vitest";
import {
  leafLinkInventoryToUltraCompactResponse,
  LEAFLINK_INVENTORY_COMPACT_FIELD_COUNT,
} from "./leafLinkInventoryListDto.js";
import type { LeafLinkInventoryItem, LeafLinkInventoryResponse } from "../services/leaflinkService.js";

function sampleItem(overrides: Partial<LeafLinkInventoryItem> = {}): LeafLinkInventoryItem {
  return {
    id: "p1",
    productName: "Test Product Name",
    sku: "SKU-001",
    strain: "GUAV",
    category: "Edibles",
    productType: "Gummy",
    subcategory: "Gummy",
    brand: "Brand",
    availableQuantity: 10,
    unit: "each",
    packageSize: "10pk",
    price: 12.5,
    status: "Available",
    updatedAt: "2026-01-01T00:00:00.000Z",
    imageUrl: "https://cdn.example.com/very/long/path/to/image.jpg",
    sourcePackageGroup: "PKG-1",
    ...overrides,
  };
}

describe("leafLinkInventoryListDto", () => {
  it("produces columnar compact payload much smaller than verbose objects", () => {
    const items = Array.from({ length: 500 }, (_, i) =>
      sampleItem({ id: `id-${i}`, productName: `Product ${i}` }),
    );
    const full: LeafLinkInventoryResponse = {
      source: "leaflink",
      items,
      stats: {
        totalSkus: 500,
        totalInventoryUnits: 5000,
        totalInventoryValue: 12000,
        categoriesCount: 8,
      },
      lastSyncedAt: "2026-01-01T00:00:00.000Z",
    };

    const verbose = JSON.stringify({
      items: items.map((x) => ({
        id: x.id,
        productName: x.productName,
        sku: x.sku,
        strain: x.strain,
        category: x.category,
        productType: x.productType,
        subcategory: x.subcategory,
        brand: x.brand,
        availableQuantity: x.availableQuantity,
        unit: x.unit,
        packageSize: x.packageSize,
        price: x.price,
        status: x.status,
        updatedAt: x.updatedAt,
        sourcePackageGroup: x.sourcePackageGroup,
      })),
      stats: full.stats,
      lastSyncedAt: full.lastSyncedAt,
    });

    const compact = leafLinkInventoryToUltraCompactResponse(full);
    const compactJson = JSON.stringify(compact);

    expect(compact.v).toBe(1);
    expect(compact.r).toHaveLength(500);
    expect(Buffer.byteLength(compactJson, "utf8")).toBeLessThanOrEqual(60_500);
    expect(Buffer.byteLength(compactJson, "utf8")).toBeLessThan(Buffer.byteLength(verbose, "utf8") * 0.45);
  });
});
