import { describe, expect, it } from "vitest";
import { extractionRunProductTypeLabel, isLiveResinOilRun } from "./extractionOilPool.js";

describe("isLiveResinOilRun", () => {
  it("accepts Live Resin Oil and edible oil labels", () => {
    expect(
      isLiveResinOilRun({
        extractionUiState: { productType: "Live Resin Oil" },
        productCategory: "LIVE",
      }),
    ).toBe(true);
    expect(
      isLiveResinOilRun({
        extractionUiState: { productType: "Live Resin Oil (Edible)" },
        productCategory: "LIVE",
      }),
    ).toBe(true);
  });

  it("rejects dabbable-only live resin", () => {
    expect(
      isLiveResinOilRun({
        extractionUiState: { productType: "Live Resin Dabbable" },
        productCategory: "LIVE",
      }),
    ).toBe(false);
  });

  it("rejects non-live-resin", () => {
    expect(
      isLiveResinOilRun({
        extractionUiState: { productType: "Cured Wax" },
        productCategory: "CURED_WAX",
      }),
    ).toBe(false);
  });
});

describe("extractionRunProductTypeLabel", () => {
  it("falls back to Live Resin for LIVE category without UI name", () => {
    expect(
      extractionRunProductTypeLabel({
        extractionUiState: {},
        productCategory: "LIVE",
      }),
    ).toBe("Live Resin");
  });
});
