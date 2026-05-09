import { describe, expect, it } from "vitest";
import {
  apiStaticOriginFromApiBase,
  clampCompanyHeaderLogoMaxHeightPx,
  clampCompanyHeaderLogoMaxWidthPx,
  clampInventoryLogoMaxHeightPx,
  clampInventoryLogoMaxWidthPx,
  describeInventoryFilters,
  EXPORT_COLUMN_PRESET,
  normalizeInventoryExportColumns,
  parseStoredExportColumns,
  resolveAssetUrlForPrint,
  resolveCompanyLogoImgSrc,
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

describe("EXPORT_COLUMN_PRESET", () => {
  it("is Product and Qty in table order", () => {
    expect(EXPORT_COLUMN_PRESET).toEqual(["product", "qty"]);
  });
});

describe("parseStoredExportColumns", () => {
  it("returns null when nothing usable", () => {
    expect(parseStoredExportColumns(null)).toBeNull();
    expect(parseStoredExportColumns([])).toBeNull();
    expect(parseStoredExportColumns(["bad"])).toBeNull();
  });

  it("returns ordered columns when valid", () => {
    expect(parseStoredExportColumns(["qty", "product", "sku"])).toEqual(["product", "sku", "qty"]);
  });
});

describe("clampInventoryLogoMaxWidthPx", () => {
  it("clamps to 48–720", () => {
    expect(clampInventoryLogoMaxWidthPx(10)).toBe(48);
    expect(clampInventoryLogoMaxWidthPx(9999)).toBe(720);
    expect(clampInventoryLogoMaxWidthPx(200)).toBe(200);
  });
});

describe("clampInventoryLogoMaxHeightPx", () => {
  it("returns 0 when unset or invalid", () => {
    expect(clampInventoryLogoMaxHeightPx(0)).toBe(0);
    expect(clampInventoryLogoMaxHeightPx(-1)).toBe(0);
    expect(clampInventoryLogoMaxHeightPx(NaN)).toBe(0);
  });

  it("clamps positive values to 48–560", () => {
    expect(clampInventoryLogoMaxHeightPx(10)).toBe(48);
    expect(clampInventoryLogoMaxHeightPx(9999)).toBe(560);
    expect(clampInventoryLogoMaxHeightPx(200)).toBe(200);
  });
});

describe("clampCompanyHeaderLogoMaxHeightPx", () => {
  it("returns 0 when unset", () => {
    expect(clampCompanyHeaderLogoMaxHeightPx(0)).toBe(0);
    expect(clampCompanyHeaderLogoMaxHeightPx("")).toBe(0);
  });

  it("clamps to 24–160", () => {
    expect(clampCompanyHeaderLogoMaxHeightPx(10)).toBe(24);
    expect(clampCompanyHeaderLogoMaxHeightPx(999)).toBe(160);
    expect(clampCompanyHeaderLogoMaxHeightPx(96)).toBe(96);
  });
});

describe("clampCompanyHeaderLogoMaxWidthPx", () => {
  it("returns 0 when unset", () => {
    expect(clampCompanyHeaderLogoMaxWidthPx(0)).toBe(0);
  });

  it("clamps to 64–720", () => {
    expect(clampCompanyHeaderLogoMaxWidthPx(10)).toBe(64);
    expect(clampCompanyHeaderLogoMaxWidthPx(9999)).toBe(720);
    expect(clampCompanyHeaderLogoMaxWidthPx(400)).toBe(400);
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

  it("strips trailing /api when joining upload paths", () => {
    expect(resolveAssetUrlForPrint("/uploads/company-logos/c1/x.png", "https://api.example.com/api")).toBe(
      "https://api.example.com/uploads/company-logos/c1/x.png",
    );
  });
});

describe("apiStaticOriginFromApiBase", () => {
  it("removes trailing /api", () => {
    expect(apiStaticOriginFromApiBase("https://host/api")).toBe("https://host");
    expect(apiStaticOriginFromApiBase("https://host/API")).toBe("https://host");
  });
});

describe("resolveCompanyLogoImgSrc", () => {
  it("rebases /uploads/ URLs onto NEXT_PUBLIC_API origin when stored host is wrong", () => {
    expect(
      resolveCompanyLogoImgSrc(
        "https://wrong-internal:8080/uploads/company-logos/c1/logo.png",
        "https://public-api.example/api",
      ),
    ).toBe("https://public-api.example/uploads/company-logos/c1/logo.png");
  });

  it("does not rewrite absolute CDN URLs outside /uploads/", () => {
    expect(resolveCompanyLogoImgSrc("https://cdn.example/logo.png", "https://public-api.example/api")).toBe(
      "https://cdn.example/logo.png",
    );
  });
});
