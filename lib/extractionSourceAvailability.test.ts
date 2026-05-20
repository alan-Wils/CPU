import { describe, expect, it } from "vitest";
import {
  filterSourceBatchesForExtractionAvailability,
  isLegacyMonolithicFreshFrozenSource,
  isPerBundleTransferSource,
} from "@/lib/extractionSourceAvailability";

describe("extractionSourceAvailability", () => {
  it("detects per-bundle transfer rows", () => {
    expect(
      isPerBundleTransferSource({
        id: "ff-g-1111",
        manualTransferToExtraction: true,
        metrcTag: "1111",
        grams: 3000,
        bundles: 1,
      }),
    ).toBe(true);
  });

  it("detects legacy monolithic FF by cultivation id", () => {
    expect(
      isLegacyMonolithicFreshFrozenSource({
        id: "BUKU.051926",
        source: "BUKU.051926",
        type: "Fresh Frozen",
        grams: 100000,
        bundles: 33,
      }),
    ).toBe(true);
  });

  it("drops monolithic row when per-bundle rows exist for same source", () => {
    const rows = filterSourceBatchesForExtractionAvailability([
      {
        id: "BUKU.051926",
        source: "BUKU.051926",
        type: "Fresh Frozen",
        grams: 100000,
        bundles: 33,
      },
      {
        id: "ff-g-1111",
        source: "BUKU.051926",
        type: "Fresh Frozen",
        manualTransferToExtraction: true,
        metrcTag: "1111",
        grams: 3000,
        bundles: 1,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("ff-g-1111");
  });
});
