import { describe, expect, it } from "vitest";
import {
  buildTaskChallengeAttachment,
  effectiveTaskChallengePoints,
  isTaskExcludedFromChallenge,
  rollSpeedChallengeOffer,
} from "./taskChallengePayload";
import type { RewardsSettings } from "./rewardsConfig";

const minimalRewards = (over: Partial<RewardsSettings["taskChallenge"]> = {}): RewardsSettings => ({
  enabled: true,
  primaryWindowDays: 30,
  scoring: {
    fastTaskBonusPoints: 5,
    targetMinutesByTask: {},
    potencyThresholdPercent: 20,
    potencyBonusPoints: 15,
    yieldBonusPoints: 10,
  },
  rewardItems: [],
  taskChallenge: {
    enabled: true,
    minSamplesForAverage: 5,
    includeAreaInTaskKey: true,
    tiers: [
      { label: "Fast", multiplierVsAvg: 0.85, points: 30 },
      { label: "On target", multiplierVsAvg: 1, points: 20 },
      { label: "Stretch", multiplierVsAvg: 1.15, points: 10 },
    ],
    requireManagerApproval: false,
    rewardManagerUserIds: [],
    excludedTaskSubstrings: [],
    offerChancePercent: 100,
    ...over,
  },
});

describe("effectiveTaskChallengePoints", () => {
  it("counts legacy pointsEarned only", () => {
    expect(effectiveTaskChallengePoints({ pointsEarned: 20 })).toBe(20);
  });
  it("ignores pending", () => {
    expect(
      effectiveTaskChallengePoints({
        proposedPoints: 30,
        pointsEarned: 0,
        reviewStatus: "pending",
      }),
    ).toBe(0);
  });
  it("counts approved pointsEarned", () => {
    expect(
      effectiveTaskChallengePoints({
        proposedPoints: 30,
        pointsEarned: 30,
        reviewStatus: "approved",
      }),
    ).toBe(30);
  });
  it("falls back to proposedPoints when approved but pointsEarned missing", () => {
    expect(
      effectiveTaskChallengePoints({
        proposedPoints: 15,
        reviewStatus: "approved",
      }),
    ).toBe(15);
  });
  it("denied is zero", () => {
    expect(
      effectiveTaskChallengePoints({
        proposedPoints: 30,
        pointsEarned: 30,
        reviewStatus: "denied",
      }),
    ).toBe(0);
  });
});

describe("rollSpeedChallengeOffer", () => {
  it("100 always true", () => {
    expect(rollSpeedChallengeOffer(100, () => 0.99)).toBe(true);
  });
  it("0 always false", () => {
    expect(rollSpeedChallengeOffer(0, () => 0)).toBe(false);
  });
  it("50 respects rng", () => {
    expect(rollSpeedChallengeOffer(50, () => 0)).toBe(true);
    expect(rollSpeedChallengeOffer(50, () => 0.5)).toBe(false);
  });
});

describe("isTaskExcludedFromChallenge", () => {
  it("matches substring case-insensitive", () => {
    expect(isTaskExcludedFromChallenge("Print harvest sheet", ["print"])).toBe(true);
    expect(isTaskExcludedFromChallenge("Maintenance", ["print"])).toBe(false);
  });
});

describe("buildTaskChallengeAttachment", () => {
  it("returns null when not opted in", () => {
    const r = minimalRewards();
    const out = buildTaskChallengeAttachment({
      rewards: r,
      area: "Cultivation",
      task: "Maintenance",
      customTasksRewardDefs: { cultivation: [], extraction: [], packaging: [] },
      logs: [],
      normalizedMinutesPerPerson: 10,
      user: { rewardsEnrolled: true },
      optedIn: false,
      laborGateOk: true,
    });
    expect(out).toBeNull();
  });

  it("returns approved immediate points when manager approval off", () => {
    const r = minimalRewards({ requireManagerApproval: false });
    const out = buildTaskChallengeAttachment({
      rewards: r,
      area: "Extraction",
      task: "Start Run",
      customTasksRewardDefs: { cultivation: [], extraction: [], packaging: [] },
      logs: [],
      normalizedMinutesPerPerson: 5,
      user: { rewardsEnrolled: true },
      optedIn: true,
      laborGateOk: true,
    });
    expect(out).not.toBeNull();
    expect(out!.reviewStatus).toBe("approved");
    expect(out!.pointsEarned).toBe(out!.proposedPoints);
    expect(out!.pointsEarned).toBeGreaterThan(0);
  });

  it("returns pending when manager approval on", () => {
    const r = minimalRewards({ requireManagerApproval: true });
    const out = buildTaskChallengeAttachment({
      rewards: r,
      area: "Extraction",
      task: "Start Run",
      customTasksRewardDefs: { cultivation: [], extraction: [], packaging: [] },
      logs: [],
      normalizedMinutesPerPerson: 5,
      user: { rewardsEnrolled: true },
      optedIn: true,
      laborGateOk: true,
    });
    expect(out).not.toBeNull();
    expect(out!.reviewStatus).toBe("pending");
    expect(out!.pointsEarned).toBe(0);
    expect(out!.proposedPoints).toBeGreaterThan(0);
  });
});
