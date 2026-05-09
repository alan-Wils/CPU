import { describe, expect, it } from "vitest";
import {
  extractCompanyHeaderLogoMaxHeightPx,
  extractCompanyHeaderLogoMaxWidthPx,
  extractCompanyInventoryLogoUrl,
} from "./companyConfigLogo";

describe("extractCompanyInventoryLogoUrl", () => {
  it("returns trimmed url from config shape", () => {
    expect(
      extractCompanyInventoryLogoUrl({
        sales: { inventoryPrintLogoUrl: "  /uploads/x.png " },
      }),
    ).toBe("/uploads/x.png");
  });

  it("returns empty string when missing", () => {
    expect(extractCompanyInventoryLogoUrl({})).toBe("");
    expect(extractCompanyInventoryLogoUrl(null)).toBe("");
  });
});

describe("extractCompanyHeaderLogoMaxHeightPx", () => {
  it("returns 0 when missing", () => {
    expect(extractCompanyHeaderLogoMaxHeightPx({})).toBe(0);
  });

  it("returns clamped value from sales", () => {
    expect(extractCompanyHeaderLogoMaxHeightPx({ sales: { companyHeaderLogoMaxHeightPx: 120 } })).toBe(120);
  });
});

describe("extractCompanyHeaderLogoMaxWidthPx", () => {
  it("returns 0 when missing", () => {
    expect(extractCompanyHeaderLogoMaxWidthPx({})).toBe(0);
  });

  it("returns clamped value from sales", () => {
    expect(extractCompanyHeaderLogoMaxWidthPx({ sales: { companyHeaderLogoMaxWidthPx: 520 } })).toBe(520);
  });
});
