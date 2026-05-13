import { describe, expect, it, vi } from "vitest";

vi.mock("../config/env.js", () => ({
  env: {
    LEAFLINK_BASE_URL: undefined,
  },
}));

import {
  leafLinkInventoryRowsForPageDefaultTotals,
  normalizeLeafLinkInventoryRows,
  sumLeafLinkInventoryValueUsd,
  type LeafLinkInventoryItem,
} from "./leaflinkService.js";

describe("normalizeLeafLinkInventoryRows", () => {
  it("resolves nested sub_category and product_line labels", () => {
    const raw = {
      data: [
        {
          id: "p1",
          product_name: "Test Oil",
          sub_category: { name: "Vape Cartridge" },
          wholesale_price: { amount: "12.50" },
        },
        {
          id: "p2",
          product_name: "Line Product",
          product_line: { display_name: "House Line" },
          price_schedule_price: 9.99,
        },
      ],
    };
    const rows = normalizeLeafLinkInventoryRows(raw);
    expect(rows.find((r) => r.id === "p1")?.subcategory).toBe("Vape Cartridge");
    expect(rows.find((r) => r.id === "p1")?.price).toBeCloseTo(12.5);
    expect(rows.find((r) => r.id === "p2")?.subcategory).toBe("House Line");
    expect(rows.find((r) => r.id === "p2")?.price).toBeCloseTo(9.99);
  });

  it("skips zero sale_price and still reads wholesale", () => {
    const raw = {
      results: [
        {
          id: "p3",
          product_name: "Sale Zero",
          wholesale_price: 8,
          sale_price: { amount: 0 },
        },
      ],
    };
    const [row] = normalizeLeafLinkInventoryRows(raw);
    expect(row?.price).toBe(8);
  });

  it("reads unit from unit_denomination object", () => {
    const raw = {
      products: [
        {
          id: "p4",
          product_name: "Gram Jar",
          unit_denomination: { name: "Gram", value: "1g" },
          wholesale_price: 1,
        },
      ],
    };
    const [row] = normalizeLeafLinkInventoryRows(raw);
    expect(row?.unit).toBe("Gram");
  });

  it("syncs listing/product images and absolutizes relative LeafLink media paths", () => {
    const raw = {
      data: [
        {
          id: "img1",
          product_name: "Photo product",
          wholesale_price: 1,
          listing: { image_url: "/media/listing/photo.jpg" },
        },
        {
          id: "img2",
          product_name: "Nested product image",
          wholesale_price: 2,
          product: {
            images: [{ url: "https://cdn.example.test/p.png" }],
          },
        },
      ],
    };
    const rows = normalizeLeafLinkInventoryRows(raw);
    expect(rows.find((r) => r.id === "img1")?.imageUrl).toMatch(/^https:\/\/app\.leaflink\.com\/media\/listing\/photo\.jpg$/);
    expect(rows.find((r) => r.id === "img2")?.imageUrl).toBe("https://cdn.example.test/p.png");
  });

  it("reads is_active and available_for_wholesale into listing signals", () => {
    const raw = {
      data: [
        {
          id: "flag1",
          product_name: "Flagged",
          wholesale_price: 1,
          is_active: true,
          available_for_wholesale: true,
          available_inventory: 5,
        },
      ],
    };
    const [row] = normalizeLeafLinkInventoryRows(raw);
    expect(row?.listingActive).toBe(true);
    expect(row?.wholesaleAvailable).toBe(true);
    expect(row?.availableQuantity).toBe(5);
  });

  it("prefers explicit available over total quantity when both exist", () => {
    const raw = {
      data: [
        {
          id: "avail1",
          product_name: "Split qty",
          wholesale_price: 11,
          quantity: 538,
          available: 401,
        },
      ],
    };
    const [row] = normalizeLeafLinkInventoryRows(raw);
    expect(row?.availableQuantity).toBe(401);
  });

  it("derives available from total minus reserved when explicit available is missing", () => {
    const raw = {
      data: [
        {
          id: "res1",
          product_name: "Reserved split",
          wholesale_price: 11,
          quantity: 538,
          reserved_quantity: 137,
        },
      ],
    };
    const [row] = normalizeLeafLinkInventoryRows(raw);
    expect(row?.availableQuantity).toBe(401);
  });

  it("reads available from nested listing when top-level quantity is total only", () => {
    const raw = {
      data: [
        {
          id: "nest1",
          product_name: "Nested",
          wholesale_price: 1,
          quantity: 538,
          listing: { available_inventory: 401 },
        },
      ],
    };
    const [row] = normalizeLeafLinkInventoryRows(raw);
    expect(row?.availableQuantity).toBe(401);
  });

  it("combines distinct product_type with strain when category matches type", () => {
    const raw = {
      data: [
        {
          id: "p5",
          product_name: "Flower X",
          category: "Flower",
          product_type: "Flower",
          strain_classification_display: "Indica",
          wholesale_price: 20,
        },
      ],
    };
    const [row] = normalizeLeafLinkInventoryRows(raw);
    expect(row?.subcategory).toContain("Indica");
  });
});

describe("leafLinkInventoryRowsForPageDefaultTotals + sumLeafLinkInventoryValueUsd", () => {
  function row(p: Partial<LeafLinkInventoryItem>): LeafLinkInventoryItem {
    return {
      id: "id",
      productName: "n",
      sku: "s",
      strain: "",
      category: "",
      productType: "",
      subcategory: "",
      brand: "",
      availableQuantity: 0,
      unit: "",
      packageSize: "",
      price: 0,
      status: "",
      updatedAt: "",
      imageUrl: "",
      sourcePackageGroup: "",
      ...p,
    };
  }

  it("matches Inventory page defaults: Available + qty > 0", () => {
    const rows = [
      row({ id: "a", availableQuantity: 2, price: 10, status: "Available" }),
      row({ id: "b", availableQuantity: 1, price: 5, status: "Internal" }),
      row({ id: "c", availableQuantity: 0, price: 99, status: "Available" }),
      row({ id: "d", availableQuantity: 3, price: 1, status: "available" }),
    ];
    const f = leafLinkInventoryRowsForPageDefaultTotals(rows);
    expect(f.map((r) => r.id).sort()).toEqual(["a", "d"]);
    expect(sumLeafLinkInventoryValueUsd(f)).toBeCloseTo(23);
  });
});
