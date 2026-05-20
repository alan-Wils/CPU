import { describe, expect, it } from "vitest";
import { isPlaceholderFreshFrozenMetrcTag } from "./freshFrozenMetrcTag.js";

describe("isPlaceholderFreshFrozenMetrcTag", () => {
    it("flags empty and BUNDLE placeholders", () => {
        expect(isPlaceholderFreshFrozenMetrcTag("")).toBe(true);
        expect(isPlaceholderFreshFrozenMetrcTag("BUNDLE")).toBe(true);
        expect(isPlaceholderFreshFrozenMetrcTag("BUNDLE-3")).toBe(true);
    });

    it("accepts real METRC-style tags", () => {
        expect(isPlaceholderFreshFrozenMetrcTag("1A4060300002FE10000001234")).toBe(false);
        expect(isPlaceholderFreshFrozenMetrcTag("PKG-0009")).toBe(false);
    });
});
