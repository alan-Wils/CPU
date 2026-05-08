import { describe, expect, it } from "vitest";
import { extractCompanyInventoryLogoUrl } from "./companyConfigLogo";

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
