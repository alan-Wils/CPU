import { describe, expect, it } from "vitest";
import {
  filterSourceBatchesForExtractionAvailability,
  isEmptyPrismaSourcePlaceholder,
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

  it("drops empty prisma placeholder packages", () => {
    expect(
      isEmptyPrismaSourcePlaceholder({
        id: "clxxxxxxxxxxxxxxxxxxxxxx",
        type: "Fresh Frozen",
        grams: 0,
        weightLbs: 0,
        amount: "",
      }),
    ).toBe(true);
    const rows = filterSourceBatchesForExtractionAvailability([
      {
        id: "clxxxxxxxxxxxxxxxxxxxxxx",
        type: "Fresh Frozen",
        grams: 0,
      },
      {
        id: "BATCH.052026",
        type: "Dry Trim",
        weightLbs: 50,
        amount: "50 lbs",
        manualTransferToExtraction: true,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("BATCH.052026");
  });

  it("treats single-bundle FF with grams as per-bundle without metrc in summary", () => {
    expect(
      isPerBundleTransferSource({
        id: "ff-1",
        type: "Fresh Frozen",
        grams: 3000,
        bundles: 1,
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
