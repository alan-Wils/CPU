import { describe, expect, it } from "vitest";
import {
  computeLocalSendWindowSummary,
  decideMembershipCashLogDigest,
  digestAlreadySentToday,
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

  it("second in-window decision same day skips as already_sent_today after marker instant", () => {
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
    expect(d.decision).toBe("skip");
    expect(d.skipReason).toBe("already_sent_today");
    expect(d.suppressDuplicateSchedule).toBe(true);
    expect(d.alreadySentToday).toBe(true);
  });

  it("new saved schedule revision allows another digest same calendar day after an earlier send", () => {
    const inWindow = new Date("2026-05-05T17:20:00.000Z"); // 11:20 MDT
    const lastSentEarlier = new Date("2026-05-05T17:10:00.000Z"); // 11:10 MDT
    const block = decideMembershipCashLogDigest(
      baseDecisionInput(lastSentEarlier, inWindow, {
        cashLogEodScheduleGeneration: 4,
        cashLogEodDigestSentScheduleGeneration: 4,
      }),
    );
    expect(block.decision).toBe("skip");
    expect(block.skipReason).toBe("already_sent_today");

    const allow = decideMembershipCashLogDigest(
      baseDecisionInput(lastSentEarlier, inWindow, {
        cashLogEodScheduleGeneration: 5,
        cashLogEodDigestSentScheduleGeneration: null,
      }),
    );
    expect(allow.decision).toBe("send");
    expect(allow.suppressDuplicateSchedule).toBe(false);
  });
});
