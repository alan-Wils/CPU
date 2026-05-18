import { describe, expect, it } from "vitest";
import { expandLeafLinkInventoryDto } from "@/lib/leafLinkInventoryCompact";

describe("expandLeafLinkInventoryDto", () => {
  it("expands v1 columnar wire format into items", () => {
    const expanded = expandLeafLinkInventoryDto({
      v: 1,
      r: [["p1", "Widget", "SKU-1", "ST", "Edibles", "Gummy", "Brand", 5, "ea", "1g", 12.5, "Available", 1_700_000_000, "PKG"]],
      st: [1, 5, 12, 1],
      ls: 1_700_000_000,
      fc: 1,
    });
    expect(expanded.items).toHaveLength(1);
    expect(expanded.items?.[0]?.productName).toBe("Widget");
    expect(expanded.items?.[0]?.availableQuantity).toBe(5);
    expect(expanded.fromCache).toBe(true);
  });

  it("passes through legacy items array", () => {
    const expanded = expandLeafLinkInventoryDto({
      source: "leaflink",
      items: [
        {
          id: "a",
          productName: "Legacy",
          sku: "",
          strain: "",
          category: "",
          productType: "",
          brand: "",
          availableQuantity: 1,
          unit: "",
          packageSize: "",
          price: null,
          status: "",
          updatedAt: "",
        },
      ],
      stats: { totalSkus: 1, totalInventoryUnits: 1, totalInventoryValue: 0, categoriesCount: 0 },
      lastSyncedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(expanded.items).toHaveLength(1);
    expect(expanded.items?.[0]?.productName).toBe("Legacy");
  });
});
