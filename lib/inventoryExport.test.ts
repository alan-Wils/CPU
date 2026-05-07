import { describe, expect, it } from "vitest";
import {
  clampInventoryLogoMaxWidthPx,
  describeInventoryFilters,
  normalizeInventoryExportColumns,
  resolveAssetUrlForPrint,
} from "@/lib/inventoryExport";

describe("describeInventoryFilters", () => {
  it("includes search and category when set", () => {
    const lines = describeInventoryFilters({
      query: "  resin ",
      categoryFilter: "Concentrate",
      subcategoryFilter: "all",
      brandFilter: "all",
      statusFilter: "all",
      availabilityFilter: "in_stock",
      sortBy: "name",
      sortDir: "asc",
      layoutMode: "flat",
    });
    expect(lines.some((l) => l.includes('Search: "resin"'))).toBe(true);
    expect(lines.some((l) => l.includes("Category: Concentrate"))).toBe(true);
  });

  it("notes grouped layout mode", () => {
    const lines = describeInventoryFilters({
      query: "",
      categoryFilter: "all",
      subcategoryFilter: "all",
      brandFilter: "all",
      statusFilter: "all",
      availabilityFilter: "all",
      sortBy: "qty",
      sortDir: "desc",
      layoutMode: "grouped",
    });
    expect(lines.some((l) => l.includes("grouped by source package"))).toBe(true);
    expect(lines.some((l) => l.includes("Sort: qty"))).toBe(true);
  });
});

describe("normalizeInventoryExportColumns", () => {
  it("returns default when empty or invalid", () => {
    expect(normalizeInventoryExportColumns(null).length).toBeGreaterThan(0);
    expect(normalizeInventoryExportColumns([]).length).toBeGreaterThan(0);
    expect(normalizeInventoryExportColumns(["nope"]).length).toBeGreaterThan(0);
  });

  it("keeps order and filters unknown ids", () => {
    const out = normalizeInventoryExportColumns(["sku", "product", "bogus"]);
    expect(out).toEqual(["product", "sku"]);
  });
});

describe("clampInventoryLogoMaxWidthPx", () => {
  it("clamps to 48–400", () => {
    expect(clampInventoryLogoMaxWidthPx(10)).toBe(48);
    expect(clampInventoryLogoMaxWidthPx(9999)).toBe(400);
    expect(clampInventoryLogoMaxWidthPx(200)).toBe(200);
  });
});

describe("resolveAssetUrlForPrint", () => {
  it("leaves absolute URLs unchanged", () => {
    expect(resolveAssetUrlForPrint("https://x.test/a.png", "http://localhost:4000")).toBe("https://x.test/a.png");
  });

  it("prefixes API base for root-relative uploads", () => {
    expect(resolveAssetUrlForPrint("/uploads/company-logos/c1/x.png", "http://localhost:4000")).toBe(
      "http://localhost:4000/uploads/company-logos/c1/x.png",
    );
  });
});
