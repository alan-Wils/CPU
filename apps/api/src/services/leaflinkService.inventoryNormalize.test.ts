import { describe, expect, it, vi } from "vitest";

vi.mock("../config/env.js", () => ({
  env: {
    LEAFLINK_BASE_URL: undefined,
  },
}));

import { normalizeLeafLinkInventoryRows } from "./leaflinkService.js";

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
