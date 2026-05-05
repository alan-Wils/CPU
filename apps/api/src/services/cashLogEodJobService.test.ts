import { describe, expect, it } from "vitest";
import { isWithinSendWindow, zonedCalendarParts } from "./cashLogEodJobService.js";
import type { CashLogEodPrefs } from "../lib/cashLogEodPrefs.js";

describe("cashLogEodJobService", () => {
  it("zonedCalendarParts returns weekday and dateKey in America/New_York", () => {
    const d = new Date("2026-05-05T22:30:00.000Z");
    const p = zonedCalendarParts(d, "America/New_York");
    expect(p.dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.weekday).toBeGreaterThanOrEqual(0);
    expect(p.weekday).toBeLessThanOrEqual(6);
  });

  it("isWithinSendWindow matches slack after send time", () => {
    const prefs: CashLogEodPrefs = {
      enabled: true,
      weekdays: [1, 2, 3, 4, 5, 6, 0],
      sendTime: "09:00",
      window: "LAST_24H",
      timezone: "UTC",
    };
    const t = new Date("2026-05-04T09:10:00.000Z");
    expect(isWithinSendWindow(t, prefs, 30)).toBe(true);
    const early = new Date("2026-05-04T08:50:00.000Z");
    expect(isWithinSendWindow(early, prefs, 30)).toBe(false);
  });
});
