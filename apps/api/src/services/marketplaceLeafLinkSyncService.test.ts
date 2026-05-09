import { describe, expect, it } from "vitest";
import { marketplaceAvailabilityFromLeafLinkStatus } from "./marketplaceLeafLinkSyncService.js";

describe("marketplaceAvailabilityFromLeafLinkStatus", () => {
  it("maps LeafLink presets from inventory UI", () => {
    expect(marketplaceAvailabilityFromLeafLinkStatus("Available", 5)).toBe("AVAILABLE");
    expect(marketplaceAvailabilityFromLeafLinkStatus("Internal", 3)).toBe("AVAILABLE");
    expect(marketplaceAvailabilityFromLeafLinkStatus("Internal", 0)).toBe("INTERNAL");
    expect(marketplaceAvailabilityFromLeafLinkStatus("Unavailable", 0)).toBe("NOT_AVAILABLE");
    expect(marketplaceAvailabilityFromLeafLinkStatus("Archived", 0)).toBe("NOT_AVAILABLE");
  });

  it("treats unavailable before available substring", () => {
    expect(marketplaceAvailabilityFromLeafLinkStatus("Unavailable", 2)).toBe("NOT_AVAILABLE");
  });

  it("uses quantity when status is unknown", () => {
    expect(marketplaceAvailabilityFromLeafLinkStatus("", 10)).toBe("AVAILABLE");
    expect(marketplaceAvailabilityFromLeafLinkStatus("  ", 0)).toBe("NOT_AVAILABLE");
  });

  it("maps common wholesale listing tokens", () => {
    expect(marketplaceAvailabilityFromLeafLinkStatus("live", 1)).toBe("AVAILABLE");
    expect(marketplaceAvailabilityFromLeafLinkStatus("published", 1)).toBe("AVAILABLE");
    expect(marketplaceAvailabilityFromLeafLinkStatus("draft", 9)).toBe("INTERNAL");
    expect(marketplaceAvailabilityFromLeafLinkStatus("inactive", 4)).toBe("NOT_AVAILABLE");
  });

  it("uses LeafLink is_active / wholesale flags when status is sparse", () => {
    expect(
      marketplaceAvailabilityFromLeafLinkStatus("", 12, { listingActive: true }),
    ).toBe("AVAILABLE");
    expect(
      marketplaceAvailabilityFromLeafLinkStatus("", 3, { wholesaleAvailable: true }),
    ).toBe("AVAILABLE");
    expect(marketplaceAvailabilityFromLeafLinkStatus("", 0, { listingActive: true })).toBe(
      "NOT_AVAILABLE",
    );
  });
});
