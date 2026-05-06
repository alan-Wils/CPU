import { describe, expect, it } from "vitest";
import { computeLaborRangeDeduction, normalizeLaborBreaksFromConfig, hmToMinutes } from "@/lib/laborBreaks";

describe("laborBreaks", () => {
  it("hmToMinutes parses padded times", () => {
    expect(hmToMinutes("09:30")).toBe(9 * 60 + 30);
    expect(hmToMinutes("00:00")).toBe(0);
  });

  it("deducts lunch overlapping work span", () => {
    const breaks = normalizeLaborBreaksFromConfig([
      { id: "l", label: "Lunch", start: "12:00", end: "13:00" },
    ]);
    const r = computeLaborRangeDeduction({
      startHm: "08:00",
      endHm: "17:00",
      breaks,
    });
    expect(r.grossMinutes).toBe(9 * 60);
    expect(r.breakDeductionMinutes).toBe(60);
    expect(r.netMinutes).toBe(9 * 60 - 60);
  });

  it("handles overnight end time", () => {
    const breaks = normalizeLaborBreaksFromConfig([]);
    const r = computeLaborRangeDeduction({ startHm: "22:00", endHm: "06:00", breaks });
    expect(r.grossMinutes).toBe(8 * 60);
    expect(r.netMinutes).toBe(8 * 60);
  });
});
