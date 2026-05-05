import { describe, expect, it } from "vitest";
import {
  computeLocalSendWindowSummary,
  decideMembershipCashLogDigest,
  digestAlreadySentToday,
  duplicateDigestSuppressesSameSchedule,
  isAtOrPastConfiguredLocalSendTime,
  isWithinSendWindow,
  zonedCalendarParts,
} from "./cashLogEodJobService.js";
import type { CashLogEodPrefs } from "../lib/cashLogEodPrefs.js";

const denverPrefs: CashLogEodPrefs = {
  enabled: true,
  weekdays: [1, 2, 3, 4, 5],
  sendTime: "11:16",
  window: "LAST_24H",
  timezone: "America/Denver",
};

function baseDecisionInput(
  lastSentAt: Date | null,
  nowUtc: Date,
  gens?: {
    cashLogEodScheduleGeneration?: number;
    cashLogEodDigestSentScheduleGeneration?: number | null;
  },
) {
  return {
    nowUtc,
    slackMinutes: 25,
    prefsRaw: denverPrefs,
    cashLogEodLastSentAt: lastSentAt,
    cashLogEodScheduleGeneration: gens?.cashLogEodScheduleGeneration ?? 0,
    cashLogEodDigestSentScheduleGeneration:
      gens?.cashLogEodDigestSentScheduleGeneration ?? null,
    userActive: true,
    userEmail: "finance@example.com",
  };
}

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

  it("computeLocalSendWindowSummary labels window in local timezone", () => {
    const prefs: CashLogEodPrefs = {
      enabled: true,
      weekdays: [1, 2, 3, 4, 5],
      sendTime: "11:16",
      window: "LAST_7_DAYS",
      timezone: "America/Denver",
    };
    const now = new Date("2026-05-05T17:17:00.000Z");
    const h = computeLocalSendWindowSummary(now, prefs, 25);
    expect(h.timezone).toBe("America/Denver");
    expect(h.sendTimeConfigured).toBe("11:16");
    expect(h.windowStartLocal).toBe("11:16");
    expect(h.windowEndLocal).toBe("11:41");
    expect(h.currentLocalTime).toBe("11:17");
    expect(h.sendWindowMode).toBe("strict_slack");
    const he = computeLocalSendWindowSummary(now, prefs, 25, "eod_local_day");
    expect(he.windowEndLocal).toBe("23:59 (end of local day)");
    expect(he.sendWindowMode).toBe("eod_local_day");
  });

  it("isAtOrPastConfiguredLocalSendTime matches strict lower bound without upper cap", () => {
    const prefs: CashLogEodPrefs = denverPrefs;
    const strictEdge = new Date("2026-05-05T17:40:59.999Z"); // ~11:40 MDT vs send 11:16 + 25m → still within strict
    expect(isWithinSendWindow(strictEdge, prefs, 25)).toBe(true);
    const pastStrict = new Date("2026-05-05T19:00:00.000Z"); // 13:00 MDT
    expect(isWithinSendWindow(pastStrict, prefs, 25)).toBe(false);
    expect(isAtOrPastConfiguredLocalSendTime(pastStrict, prefs)).toBe(true);
    const inputPastStrict = baseDecisionInput(null, pastStrict);
    expect(decideMembershipCashLogDigest(inputPastStrict).decision).toBe("skip");
    expect(decideMembershipCashLogDigest(inputPastStrict).skipReason).toBe(
      "outside_send_window",
    );
    expect(
      decideMembershipCashLogDigest({
        ...inputPastStrict,
        sendWindowMode: "eod_local_day",
      }).decision,
    ).toBe("send");
  });

  it("outside-window tick skips; later in-window same day chooses send without prior marker", () => {
    const beforeWindow = new Date("2026-05-05T16:59:59.999Z");
    let d = decideMembershipCashLogDigest(
      baseDecisionInput(null, beforeWindow),
    );
    expect(d.decision).toBe("skip");
    expect(d.skipReason).toBe("outside_send_window");
    expect(d.alreadySentToday).toBe(false);

    const inWindow = new Date("2026-05-05T17:17:00.000Z");
    d = decideMembershipCashLogDigest(baseDecisionInput(null, inWindow));
    expect(d.decision).toBe("send");
    expect(d.alreadySentToday).toBe(false);
  });

  it("digestAlreadySentToday is false for lastSent yesterday (Denver)", () => {
    const yesterdaySend = new Date("2026-05-05T06:00:00.000Z");
    const thisMorningUtc = new Date("2026-05-06T17:17:00.000Z");
    expect(digestAlreadySentToday(yesterdaySend, thisMorningUtc, "America/Denver")).toBe(false);
  });

  it("second in-window decision same day still sends (no daily duplicate cap)", () => {
    const inWindowFirst = new Date("2026-05-05T17:17:00.000Z");
    let d = decideMembershipCashLogDigest(
      baseDecisionInput(null, inWindowFirst),
    );
    expect(d.decision).toBe("send");

    const simulatedMarker = new Date(inWindowFirst.getTime());
    const secondTick = new Date("2026-05-05T17:21:00.000Z");
    d = decideMembershipCashLogDigest(
      baseDecisionInput(simulatedMarker, secondTick, {
        cashLogEodScheduleGeneration: 0,
        cashLogEodDigestSentScheduleGeneration: 0,
      }),
    );
    expect(d.decision).toBe("send");
    expect(d.suppressDuplicateSchedule).toBe(false);
    expect(d.alreadySentToday).toBe(true);
  });

  it("duplicateDigestSuppressesSameSchedule reflects legacy generation rule (unused for eligibility)", () => {
    const nowUtc = new Date("2026-05-05T17:21:00.000Z");
    const marker = new Date("2026-05-05T17:17:00.000Z");
    expect(
      duplicateDigestSuppressesSameSchedule({
        lastSentAt: marker,
        nowUtc,
        timezone: "America/Denver",
        scheduleGeneration: 1,
        digestSentScheduleGeneration: 1,
      }),
    ).toBe(true);
  });

  it("Denver 11:16 interprets UTC wall clock separately from America/New_York 17:00", () => {
    const utc = new Date("2026-05-05T17:22:00.000Z"); // ~11:22 America/Denver (MDT), ~13:22 America/New_York (EDT)
    const denver = decideMembershipCashLogDigest(
      baseDecisionInput(null, utc, undefined),
    );
    expect(denver.sendWindowMode).toBe("strict_slack");
    expect(denver.decision).toBe("send");
    expect(denver.prefs?.timezone).toBe("America/Denver");
    expect(denver.prefs?.sendTime).toBe("11:16");

    const nycPrefs: CashLogEodPrefs = {
      enabled: true,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      sendTime: "17:00",
      window: "LAST_24H",
      timezone: "America/New_York",
    };
    const nyc = decideMembershipCashLogDigest({
      nowUtc: utc,
      slackMinutes: 25,
      prefsRaw: nycPrefs,
      cashLogEodLastSentAt: null,
      cashLogEodScheduleGeneration: 0,
      cashLogEodDigestSentScheduleGeneration: null,
      userActive: true,
      userEmail: "x@y.z",
    });
    expect(nyc.decision).toBe("skip");
    expect(nyc.skipReason).toBe("outside_send_window");
    expect(nyc.prefs?.sendTime).toBe("17:00");
  });

  it("America/New_York 17:00 triggers inside strict slack", () => {
    const utc = new Date("2026-05-05T21:18:00.000Z"); // 17:18 Eastern (EDT)
    const nycPrefs: CashLogEodPrefs = {
      enabled: true,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      sendTime: "17:00",
      window: "LAST_24H",
      timezone: "America/New_York",
    };
    const d = decideMembershipCashLogDigest({
      nowUtc: utc,
      slackMinutes: 25,
      prefsRaw: nycPrefs,
      cashLogEodLastSentAt: null,
      cashLogEodScheduleGeneration: 0,
      cashLogEodDigestSentScheduleGeneration: null,
      userActive: true,
      userEmail: "x@y.z",
    });
    expect(d.decision).toBe("send");
  });

  it("in-window sends even when digestSentScheduleGeneration matches schedule generation", () => {
    const inWindow = new Date("2026-05-05T17:20:00.000Z"); // 11:20 MDT
    const lastSentEarlier = new Date("2026-05-05T17:10:00.000Z"); // 11:10 MDT
    const d = decideMembershipCashLogDigest(
      baseDecisionInput(lastSentEarlier, inWindow, {
        cashLogEodScheduleGeneration: 4,
        cashLogEodDigestSentScheduleGeneration: 4,
      }),
    );
    expect(d.decision).toBe("send");

    const d2 = decideMembershipCashLogDigest(
      baseDecisionInput(lastSentEarlier, inWindow, {
        cashLogEodScheduleGeneration: 5,
        cashLogEodDigestSentScheduleGeneration: null,
      }),
    );
    expect(d2.decision).toBe("send");
    expect(d2.suppressDuplicateSchedule).toBe(false);
  });
});
