import { describe, expect, it } from "vitest";
import { describeInventoryFilters } from "@/lib/inventoryExport";

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
