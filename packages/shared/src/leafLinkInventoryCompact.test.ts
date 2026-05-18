import { describe, expect, it } from "vitest";
import {
  decodeLeafLinkInventoryCompactRow,
  encodeLeafLinkInventoryCompactRow,
  expandLeafLinkInventoryWire,
  LEAFLINK_INVENTORY_COMPACT_FIELD_COUNT,
  LEAFLINK_INVENTORY_COMPACT_VERSION,
} from "./leafLinkInventoryCompact.js";

describe("leafLinkInventoryCompact schema", () => {
  it("round-trips 500 rows with 14 fields per row", () => {
    const sample = {
      id: "p-1",
      productName: "Test Product",
      sku: "SKU-1",
      strain: "GUAV",
      category: "Edibles",
      productType: "Gummy",
      subcategory: "Gummy",
      brand: "Brand",
      availableQuantity: 12,
      unit: "each",
      packageSize: "10pk",
      price: 9.99,
      status: "Available",
      updatedAt: "2026-01-01T00:00:00.000Z",
      sourcePackageGroup: "PKG-1",
    };
    const encoded = encodeLeafLinkInventoryCompactRow(sample);
    expect(encoded).toHaveLength(LEAFLINK_INVENTORY_COMPACT_FIELD_COUNT);
    const decoded = decodeLeafLinkInventoryCompactRow(encoded);
    expect(decoded.productName).toBe("Test Product");
    expect(decoded.availableQuantity).toBe(12);
    expect(decoded.status).toBe("Available");

    const rows = Array.from({ length: 500 }, (_, i) =>
      encodeLeafLinkInventoryCompactRow({ ...sample, id: `id-${i}`, productName: `Product ${i}` }),
    );
    const { payload, diagnostics } = expandLeafLinkInventoryWire({
      v: LEAFLINK_INVENTORY_COMPACT_VERSION,
      r: rows,
      st: [500, 5000, 12000, 8],
      ls: 1_700_000_000,
      fc: 1,
    });
    expect(diagnostics.wireRowCount).toBe(500);
    expect(diagnostics.decodedRowCount).toBe(500);
    expect(diagnostics.schemaMismatch).toBe(false);
    expect(payload.items).toHaveLength(500);
    expect(payload.fromCache).toBe(true);
  });

  it("skips invalid compact rows without zeroing the whole list", () => {
    const good = encodeLeafLinkInventoryCompactRow({
      id: "ok",
      productName: "Good",
      sku: "SKU",
      strain: "",
      category: "Edibles",
      productType: "Gummy",
      subcategory: "Gummy",
      brand: "",
      availableQuantity: 5,
      unit: "ea",
      packageSize: "",
      price: 10,
      status: "Available",
      updatedAt: "2026-01-01T00:00:00.000Z",
      sourcePackageGroup: "",
    });
    const { payload, diagnostics } = expandLeafLinkInventoryWire({
      v: LEAFLINK_INVENTORY_COMPACT_VERSION,
      r: [good, ["too", "short"] as unknown as typeof good, good],
      st: [2, 10, 50, 1],
      ls: 1_700_000_000,
    });
    expect(payload.items).toHaveLength(2);
    expect(diagnostics.schemaMismatch).toBe(false);
  });

  it("decodes legacy items[] object rows", () => {
    const { payload } = expandLeafLinkInventoryWire({
      source: "leaflink",
      items: [
        {
          id: "a",
          productName: "Legacy",
          sku: "S",
          strain: "",
          category: "Flower",
          productType: "",
          subcategory: "",
          brand: "",
          availableQuantity: 3,
          unit: "g",
          packageSize: "",
          price: null,
          status: "Available",
          updatedAt: "2026-01-01T00:00:00.000Z",
          sourcePackageGroup: "",
        },
      ],
      stats: { totalSkus: 1, totalInventoryUnits: 3, totalInventoryValue: 0, categoriesCount: 1 },
      lastSyncedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]?.productName).toBe("Legacy");
  });
});
