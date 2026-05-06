import { describe, expect, it } from "vitest";
import {
  formatYmdInTimezone,
  utcIsoNoonOnYmdInTimezone,
} from "@/lib/companyTimezone";

describe("companyTimezone stage-move helpers", () => {
  it("formatYmdInTimezone returns padded YYYY-MM-DD for a known UTC instant", () => {
    const d = new Date("2026-05-06T18:00:00.000Z");
    const ny = formatYmdInTimezone(d, "America/New_York");
    expect(ny).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ny).not.toBe("");
  });

  it("utcIsoNoonOnYmdInTimezone yields noon wall time on UTC calendar day", () => {
    const iso = utcIsoNoonOnYmdInTimezone("2026-05-10", "UTC");
    const d = new Date(iso);
    expect(Number.isFinite(d.getTime())).toBe(true);
    expect(d.toISOString().slice(0, 10)).toBe("2026-05-10");
    expect(d.getUTCHours()).toBe(12);
    expect(d.getUTCMinutes()).toBe(0);
  });
});
