import { describe, expect, it } from "vitest";
import {
  applySourcePackageIdsToBatch,
  formatSourcePackageIdsForInput,
  parseSourcePackageIdsInput,
  sourcePackageIdsFromBatch,
} from "@/lib/packagingSourcePackages";

describe("packagingSourcePackages", () => {
  it("parses comma and newline separated ids", () => {
    expect(parseSourcePackageIdsInput("FF-A, FF-B\nFF-C")).toEqual(["FF-A", "FF-B", "FF-C"]);
  });

  it("reads ids from extractionSources", () => {
    expect(
      sourcePackageIdsFromBatch({
        source: "wrong-cuid",
        extractionSources: [{ sourceId: "FF-BLUE.051526", amountUsed: 10 }],
      }),
    ).toEqual(["FF-BLUE.051526"]);
  });

  it("applySourcePackageIdsToBatch updates source and rows", () => {
    const next = applySourcePackageIdsToBatch(
      {
        id: "LOT-1",
        extractionSources: [{ sourceId: "FF-A", amountUsed: 5, name: "Blue" }],
      },
      ["FF-A", "FF-B"],
    );
    expect(next.source).toBe("FF-A, FF-B");
    expect(next.extractionSources).toHaveLength(2);
    expect(next.extractionSources[0].amountUsed).toBe(5);
    expect(next.extractionSources[1].sourceId).toBe("FF-B");
  });

  it("formatSourcePackageIdsForInput joins ids", () => {
    expect(
      formatSourcePackageIdsForInput({
        extractionSources: [{ sourceId: "FF-X" }, { sourceId: "FF-Y" }],
      }),
    ).toBe("FF-X, FF-Y");
  });
});
