import { describe, expect, it } from "vitest";
import {
  extractLiveOrderNotificationsEnabled,
  extractLiveTaskNotificationsEnabled,
} from "./taskNotificationsConfig";

describe("extractLiveTaskNotificationsEnabled", () => {
  it("defaults to true when missing", () => {
    expect(extractLiveTaskNotificationsEnabled({})).toBe(true);
    expect(extractLiveTaskNotificationsEnabled({ company: { settings: {} } })).toBe(true);
  });

  it("respects explicit false", () => {
    expect(
      extractLiveTaskNotificationsEnabled({
        company: { settings: { liveTaskNotifications: false } },
      }),
    ).toBe(false);
  });

  it("treats true as enabled", () => {
    expect(
      extractLiveTaskNotificationsEnabled({
        company: { settings: { liveTaskNotifications: true } },
      }),
    ).toBe(true);
  });
});

describe("extractLiveOrderNotificationsEnabled", () => {
  it("defaults to true when missing", () => {
    expect(extractLiveOrderNotificationsEnabled({})).toBe(true);
    expect(extractLiveOrderNotificationsEnabled({ company: { settings: {} } })).toBe(true);
  });

  it("respects explicit false", () => {
    expect(
      extractLiveOrderNotificationsEnabled({
        company: { settings: { liveOrderNotifications: false } },
      }),
    ).toBe(false);
  });
});
