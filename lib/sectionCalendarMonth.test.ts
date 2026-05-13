import { describe, expect, it } from "vitest";
import { monthYmdBounds, shiftMonthYyyyMm, startOfMonthDate, ymdInLocalTimezone } from "./sectionCalendarMonth";

describe("monthYmdBounds", () => {
  it("returns first and last day for a 31-day month", () => {
    expect(monthYmdBounds("2026-05")).toEqual({ fromYmd: "2026-05-01", toYmd: "2026-05-31" });
  });

  it("handles February in a leap year", () => {
    expect(monthYmdBounds("2024-02")).toEqual({ fromYmd: "2024-02-01", toYmd: "2024-02-29" });
  });

  it("handles February in a non-leap year", () => {
    expect(monthYmdBounds("2025-02")).toEqual({ fromYmd: "2025-02-01", toYmd: "2025-02-28" });
  });

  it("throws on invalid month token", () => {
    expect(() => monthYmdBounds("2026-13")).toThrow("Invalid month");
    expect(() => monthYmdBounds("bad")).toThrow("Invalid month");
  });
});

describe("shiftMonthYyyyMm", () => {
  it("rolls year when crossing January boundary", () => {
    expect(shiftMonthYyyyMm("2026-01", -1)).toBe("2025-12");
    expect(shiftMonthYyyyMm("2025-12", 1)).toBe("2026-01");
  });
});

describe("ymdInLocalTimezone", () => {
  it("formats local calendar date", () => {
    const d = new Date(2026, 4, 12, 15, 30, 0);
    expect(ymdInLocalTimezone(d)).toBe("2026-05-12");
  });
});

describe("startOfMonthDate", () => {
  it("returns local midnight of first of month", () => {
    const d = startOfMonthDate("2026-03");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(1);
  });
});
