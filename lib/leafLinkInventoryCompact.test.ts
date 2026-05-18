import { describe, expect, it } from "vitest";
import { expandLeafLinkInventoryDto } from "@/lib/leafLinkInventoryCompact";
import { LEAFLINK_INVENTORY_COMPACT_FIELD_COUNT, LEAFLINK_INVENTORY_COMPACT_VERSION } from "@cpu/shared";
import { inventoryStatusMatchesFilter } from "@/lib/leafLinkInventoryFilters";

describe("expandLeafLinkInventoryDto", () => {
  it("expands v1 columnar wire format into items", () => {
    const expanded = expandLeafLinkInventoryDto({
      v: LEAFLINK_INVENTORY_COMPACT_VERSION,
      r: [
        [
          "p1",
          "Widget",
          "SKU-1",
          "ST",
          "Edibles",
          "Gummy",
          "Brand",
          5,
          "ea",
          "1g",
          12.5,
          "Available",
          1_700_000_000,
          "PKG",
        ],
      ],
      st: [1, 5, 12, 1],
      ls: 1_700_000_000,
      fc: 1,
    });
    expect(expanded.items).toHaveLength(1);
    expect(expanded.items?.[0]?.productName).toBe("Widget");
    expect(expanded.items?.[0]?.availableQuantity).toBe(5);
    expect(expanded.items?.[0]?.status).toBe("Available");
    expect(expanded.fromCache).toBe(true);
  });

  it("decodes 500-row production-like payload", () => {
    const row = [
      "id-0",
      "Product 0",
      "SKU",
      "",
      "Edibles",
      "Gummy",
      "Brand",
      10,
      "ea",
      "",
      12,
      "Available",
      1_700_000_000,
      "PKG",
    ];
    const r = Array.from({ length: 500 }, (_, i) => {
      const copy = [...row];
      copy[0] = `id-${i}`;
      copy[1] = `Product ${i}`;
      return copy;
    });
    const expanded = expandLeafLinkInventoryDto({
      v: 1,
      r,
      st: [500, 5000, 0, 1],
      ls: 1_700_000_000,
    });
    expect(expanded.items).toHaveLength(500);
    expect(expanded.items?.[0]?.id).toBe("id-0");
    expect(LEAFLINK_INVENTORY_COMPACT_FIELD_COUNT).toBe(14);
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

describe("inventoryStatusMatchesFilter", () => {
  it("matches Available variants", () => {
    expect(inventoryStatusMatchesFilter("Available", "Available")).toBe(true);
    expect(inventoryStatusMatchesFilter("available for sale", "Available")).toBe(true);
    expect(inventoryStatusMatchesFilter("", "Available")).toBe(true);
    expect(inventoryStatusMatchesFilter("Archived", "Available")).toBe(false);
  });
});
