import { describe, expect, it } from "vitest";
import {
  bundleSlotCountFromTotalGrams,
} from "./freshFrozenPackageDisplay";
import {
  fillAscendingMetrcTagsFromFirstBundle,
  incrementMetrcPackageTag,
  splitGramsByConfiguredBundleSize,
  sumFreshFrozenBundleGrams,
} from "./freshFrozenBundleRows";

describe("splitGramsByConfiguredBundleSize", () => {
  it("splits into full bundles plus partial remainder", () => {
    const rows = splitGramsByConfiguredBundleSize(1000, 300);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => Number(r.grams))).toEqual([300, 300, 300, 100]);
    expect(sumFreshFrozenBundleGrams(rows)).toBe(1000);
  });

  it("uses one partial-only bundle when total is below bundle size", () => {
    const rows = splitGramsByConfiguredBundleSize(250, 300);
    expect(rows).toHaveLength(1);
    expect(rows[0].grams).toBe("250");
  });

  it("preserves METRC tags by row index when resizing", () => {
    const first = splitGramsByConfiguredBundleSize(600, 300);
    first[0].metrcTag = "TAG-A";
    first[1].metrcTag = "TAG-B";
    const resized = splitGramsByConfiguredBundleSize(1000, 300, first);
    expect(resized[0].metrcTag).toBe("TAG-A");
    expect(resized[1].metrcTag).toBe("TAG-B");
    expect(resized[2].metrcTag).toBe("");
  });
});

describe("incrementMetrcPackageTag", () => {
  it("increments all-digit tags", () => {
    expect(incrementMetrcPackageTag("1111", 0)).toBe("1111");
    expect(incrementMetrcPackageTag("1111", 1)).toBe("1112");
    expect(incrementMetrcPackageTag("1111", 3)).toBe("1114");
  });

  it("increments trailing digits and preserves prefix", () => {
    expect(incrementMetrcPackageTag("PKG-0009", 1)).toBe("PKG-0010");
  });
});

describe("fillAscendingMetrcTagsFromFirstBundle", () => {
  it("fills rows from bundle #1", () => {
    const rows = splitGramsByConfiguredBundleSize(1000, 300);
    rows[0].metrcTag = "1111";
    const filled = fillAscendingMetrcTagsFromFirstBundle(rows);
    expect(filled.ok).toBe(true);
    expect(filled.rows.map((r) => r.metrcTag)).toEqual(["1111", "1112", "1113", "1114"]);
  });
});

describe("bundleSlotCountFromTotalGrams", () => {
  it("counts partial bundle slots with ceil", () => {
    expect(bundleSlotCountFromTotalGrams(1000, 300)).toBe(4);
    expect(bundleSlotCountFromTotalGrams(600, 300)).toBe(2);
    expect(bundleSlotCountFromTotalGrams(250, 300)).toBe(1);
  });
});
