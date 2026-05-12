import { describe, expect, it } from "vitest";
import { defaultAnalyticsDateRange } from "./analyticsDefaultDateRange";

describe("defaultAnalyticsDateRange", () => {
  it("returns first local day of month through that calendar day", () => {
    const ref = new Date(2026, 4, 12);
    expect(defaultAnalyticsDateRange(ref)).toEqual({ from: "2026-05-01", to: "2026-05-12" });
  });

  it("handles January", () => {
    const ref = new Date(2026, 0, 15);
    expect(defaultAnalyticsDateRange(ref)).toEqual({ from: "2026-01-01", to: "2026-01-15" });
  });
});
