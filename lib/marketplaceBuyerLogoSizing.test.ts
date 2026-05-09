import { describe, expect, it } from "vitest";
import {
  clampMarketplaceBuyerCardLogoMaxHeightPx,
  clampMarketplaceBuyerChipLogoMaxHeightPx,
  DEFAULT_BUYER_CARD_LOGO_MAX_H,
  resolveBuyerCardLogoMaxHeight,
  resolveBuyerModalLogoMaxHeight,
  sellerUsesBuyerCardLogoBoost,
} from "./marketplaceBuyerLogoSizing";

describe("clampMarketplaceBuyerCardLogoMaxHeightPx", () => {
  it("returns 0 when unset", () => {
    expect(clampMarketplaceBuyerCardLogoMaxHeightPx(0)).toBe(0);
    expect(clampMarketplaceBuyerCardLogoMaxHeightPx(NaN)).toBe(0);
  });

  it("clamps to 40–120", () => {
    expect(clampMarketplaceBuyerCardLogoMaxHeightPx(10)).toBe(40);
    expect(clampMarketplaceBuyerCardLogoMaxHeightPx(999)).toBe(120);
    expect(clampMarketplaceBuyerCardLogoMaxHeightPx(72)).toBe(72);
  });
});

describe("resolveBuyerCardLogoMaxHeight", () => {
  it("uses default when not boosted", () => {
    expect(resolveBuyerCardLogoMaxHeight(0)).toBe(DEFAULT_BUYER_CARD_LOGO_MAX_H);
    expect(resolveBuyerCardLogoMaxHeight(undefined)).toBe(DEFAULT_BUYER_CARD_LOGO_MAX_H);
  });

  it("uses configured value when boosted", () => {
    expect(resolveBuyerCardLogoMaxHeight(80)).toBe(80);
  });
});

describe("resolveBuyerModalLogoMaxHeight", () => {
  it("uses legacy modal height when not boosted", () => {
    expect(resolveBuyerModalLogoMaxHeight(0)).toBe(40);
  });

  it("scales with card boost", () => {
    expect(resolveBuyerModalLogoMaxHeight(72)).toBe(80);
  });
});

describe("sellerUsesBuyerCardLogoBoost", () => {
  it("is false for default", () => {
    expect(sellerUsesBuyerCardLogoBoost(0)).toBe(false);
  });

  it("is true when configured", () => {
    expect(sellerUsesBuyerCardLogoBoost(72)).toBe(true);
  });
});

describe("clampMarketplaceBuyerChipLogoMaxHeightPx", () => {
  it("clamps to 36–120", () => {
    expect(clampMarketplaceBuyerChipLogoMaxHeightPx(0)).toBe(0);
    expect(clampMarketplaceBuyerChipLogoMaxHeightPx(10)).toBe(36);
    expect(clampMarketplaceBuyerChipLogoMaxHeightPx(88)).toBe(88);
  });
});
