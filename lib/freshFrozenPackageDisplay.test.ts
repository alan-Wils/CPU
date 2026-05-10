import { describe, expect, it } from "vitest";
import {
  bundlesFromTotalGrams,
  freshFrozenPackageDisplay,
  parseFreshFrozenGramsPerBundle,
  sourceRowTotalGrams,
} from "./freshFrozenPackageDisplay";

describe("freshFrozenPackageDisplay", () => {
  it("parseFreshFrozenGramsPerBundle clamps invalid", () => {
    expect(parseFreshFrozenGramsPerBundle(0)).toBe(0);
    expect(parseFreshFrozenGramsPerBundle(-5)).toBe(0);
    expect(parseFreshFrozenGramsPerBundle(500)).toBe(500);
  });

  it("bundlesFromTotalGrams floors", () => {
    expect(bundlesFromTotalGrams(1500, 500)).toBe(3);
    expect(bundlesFromTotalGrams(1499, 500)).toBe(2);
    expect(bundlesFromTotalGrams(100, 0)).toBe(0);
  });

  it("freshFrozenPackageDisplay prefers grams on row", () => {
    const d = freshFrozenPackageDisplay({
      grams: 907.184,
      bundles: 2,
      weightLbs: 1,
    });
    expect(d.bundlesLabel).toBe("2");
    expect(d.packageLine).toContain("bundles");
  });

  it("sourceRowTotalGrams falls back to weightLbs", () => {
    expect(sourceRowTotalGrams({ weightLbs: 1, grams: 0 })).toBeGreaterThan(450);
  });
});
