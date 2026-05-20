import { describe, expect, it } from "vitest";
import {
    splitGramsAcrossFixedBundleCount,
    splitGramsEvenly,
} from "./freshFrozenBundleSplit.js";

describe("splitGramsAcrossFixedBundleCount", () => {
    it("assigns configured weight to all but last bundle", () => {
        expect(splitGramsAcrossFixedBundleCount(40857, 5100, 8)).toEqual([
            5100, 5100, 5100, 5100, 5100, 5100, 5100, 5157,
        ]);
        expect(
            splitGramsAcrossFixedBundleCount(40857, 5100, 8).reduce((a, b) => a + b, 0),
        ).toBe(40857);
    });

    it("puts entire total on one bundle when count is 1", () => {
        expect(splitGramsAcrossFixedBundleCount(250, 300, 1)).toEqual([250]);
    });

    it("matches harvest-style partial last bundle for two slots", () => {
        expect(splitGramsAcrossFixedBundleCount(1000, 300, 4)).toEqual([300, 300, 300, 100]);
    });
});

describe("splitGramsEvenly", () => {
    it("sums to total", () => {
        const amounts = splitGramsEvenly(40857, 8);
        expect(amounts).toHaveLength(8);
        expect(amounts.reduce((a, b) => a + b, 0)).toBeCloseTo(40857, 2);
    });
});
