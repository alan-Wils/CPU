import { describe, expect, it } from "vitest";
import {
  CASH_LOG_EOD_DEFAULT_SEND_TIME,
  CASH_LOG_EOD_DEFAULT_TIMEZONE,
  cashLogEodPrefsSchema,
  defaultCashLogEodPrefs,
  isValidIanaTimeZone,
  mergeCashLogEodPrefs,
  mergeScheduleIntoExistingMembershipPrefs,
} from "./cashLogEodPrefs.js";

describe("cashLogEodPrefs", () => {
  it("defaults to America/Denver and 11:16", () => {
    expect(defaultCashLogEodPrefs.timezone).toBe("America/Denver");
    expect(defaultCashLogEodPrefs.sendTime).toBe("11:16");
  });

  it("rejects invalid IANA timezone", () => {
    expect(isValidIanaTimeZone("Not/A_Real_Zone")).toBe(false);
    const r = cashLogEodPrefsSchema.safeParse({
      ...defaultCashLogEodPrefs,
      timezone: "Not/A_Real_Zone",
    });
    expect(r.success).toBe(false);
  });

  it("accepts valid timezones (Denver, New York)", () => {
    expect(isValidIanaTimeZone("America/Denver")).toBe(true);
    expect(isValidIanaTimeZone("America/New_York")).toBe(true);
    for (const tz of ["America/Denver", "America/New_York"]) {
      const r = cashLogEodPrefsSchema.safeParse({
        ...defaultCashLogEodPrefs,
        timezone: tz,
        sendTime:
          tz === "America/Denver" ? "11:16" : "17:00",
      });
      expect(r.success).toBe(true);
    }
  });

  it("coerces invalid timezone in mergeCashLogEodPrefs to default", () => {
    const m = mergeCashLogEodPrefs({
      enabled: true,
      weekdays: [1, 2, 3, 4, 5],
      sendTime: "12:30",
      window: "LAST_24H",
      timezone: "Broken/Zone",
    });
    expect(m.timezone).toBe(CASH_LOG_EOD_DEFAULT_TIMEZONE);
    expect(m.sendTime).toBe("12:30");
  });

  it("normalizes send time with seconds via schema", () => {
    const r = cashLogEodPrefsSchema.safeParse({
      ...defaultCashLogEodPrefs,
      sendTime: "09:07:00",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.sendTime).toBe("09:07");
  });

  it("fills missing send segments with defaults on bad input in schema preprocess", () => {
    const r = cashLogEodPrefsSchema.safeParse({
      ...defaultCashLogEodPrefs,
      sendTime: "not-a-time",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.sendTime).toBe(CASH_LOG_EOD_DEFAULT_SEND_TIME);
  });

  it("mergeScheduleIntoExistingMembershipPrefs keeps peer enabled but copies window/schedule", () => {
    const saver = {
      ...defaultCashLogEodPrefs,
      enabled: true,
      window: "LAST_7_DAYS" as const,
      sendTime: "12:52",
    };
    const peerRaw = {
      enabled: true,
      weekdays: [1, 2, 3, 4, 5],
      sendTime: "09:00",
      window: "LAST_24H",
      timezone: "America/Denver",
    };
    const next = mergeScheduleIntoExistingMembershipPrefs(saver, peerRaw);
    expect(next.enabled).toBe(true);
    expect(next.window).toBe("LAST_7_DAYS");
    expect(next.sendTime).toBe("12:52");
  });

  it("mergeScheduleIntoExistingMembershipPrefs turns off peer digest when peer was disabled", () => {
    const saver = { ...defaultCashLogEodPrefs, enabled: true, window: "LAST_7_DAYS" };
    const peerRaw = { ...defaultCashLogEodPrefs, enabled: false, window: "LAST_24H" };
    const next = mergeScheduleIntoExistingMembershipPrefs(saver, peerRaw);
    expect(next.enabled).toBe(false);
    expect(next.window).toBe("LAST_7_DAYS");
  });
});
