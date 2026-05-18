import { describe, expect, it } from "vitest";
import {
  getPackageOptions,
  getUnitSizeGramsFromPackageType,
  packagingProductSearchText,
} from "@/lib/packagingUnitOptions";

describe("packagingUnitOptions", () => {
  it("uses productType even when name is a custom blend label", () => {
    expect(
      getPackageOptions({
        name: "BLUE.051526",
        productType: "Live Resin Oil",
      }),
    ).toEqual(["1 Gram Cartridges", "1 Gram Disposables"]);
  });

  it("returns dabbable unit sizes", () => {
    expect(
      getPackageOptions({
        name: "Market Run A",
        productType: "Live Resin Dabbable",
      }),
    ).toEqual(["1 Gram Units", "2 Gram Units", "4 Gram Units"]);
  });

  it("matches dry sugar wax alias to cured wax sizes", () => {
    expect(
      getPackageOptions({
        name: "Batch 12",
        productType: "Dry Sugar Wax",
      }),
    ).toEqual(["2 Gram Units", "4 Gram Units"]);
  });

  it("prefers productType in search text ordering", () => {
    const text = packagingProductSearchText({
      name: "Unrelated",
      productType: "Cured Wax",
      type: "ext",
    });
    expect(text.startsWith("cured wax")).toBe(true);
  });

  it("parses gram sizes from package type labels", () => {
    expect(getUnitSizeGramsFromPackageType("1 Gram Cartridges")).toBe(1);
    expect(getUnitSizeGramsFromPackageType("2 Gram Units")).toBe(2);
    expect(getUnitSizeGramsFromPackageType("4 Gram Units")).toBe(4);
  });
});
