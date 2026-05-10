import type { CustomTasksRewardDefs, RewardWorkflowArea } from "@/lib/customTasksConfig";
import { resolveConfigurableTaskRewards } from "@/lib/customTasksConfig";
import type { RewardsSettings } from "@/lib/rewardsConfig";
import {
  computeAverageNormalizedMinutes,
  scoreChallengeByLoggedMinutes,
  type TaskLogLike,
} from "@/lib/taskChallengeMath";
import { isElevatedManagerRole } from "@cpu/shared";

export type TaskChallengeLogAttachment = {
  proposedPoints: number;
  pointsEarned: number;
  reviewStatus: "pending" | "approved" | "denied";
  tierLabel: string;
  tierIndex: number;
  targetMinutes: number;
  tierPointsMultiplier: number;
  normalizedMinutesPerPerson?: number;
  facilityAvgMinutes?: number | null;
  facilitySampleCount?: number;
  reviewedAt?: string;
  reviewedByUserId?: string;
};

/** Returns true if the random roll says we should show the challenge offer (eligible callers still apply). */
export function rollSpeedChallengeOffer(offerChancePercent: number, rng: () => number = Math.random): boolean {
  const n = Math.min(100, Math.max(0, Number(offerChancePercent)));
  if (n >= 100) return true;
  if (n <= 0) return false;
  return rng() * 100 < n;
}

export function isTaskExcludedFromChallenge(taskName: string, excluded: string[] | undefined): boolean {
  const t = String(taskName || "").toLowerCase();
  for (const ex of excluded || []) {
    const s = String(ex || "").trim().toLowerCase();
    if (s && t.includes(s)) return true;
  }
  return false;
}

/** Points that count toward rewards totals and leaderboard. */
export function effectiveTaskChallengePoints(taskChallenge: unknown): number {
  if (!taskChallenge || typeof taskChallenge !== "object") return 0;
  const o = taskChallenge as Record<string, unknown>;
  const status = o.reviewStatus;
  if (status === "denied") return 0;
  if (status === "pending") return 0;
  if (status === "approved") {
    const earned = Number(o.pointsEarned);
    if (Number.isFinite(earned) && earned > 0) return earned;
    const prop = Number(o.proposedPoints);
    return Number.isFinite(prop) && prop > 0 ? prop : 0;
  }
  const legacy = Number(o.pointsEarned);
  return Number.isFinite(legacy) && legacy > 0 ? legacy : 0;
}

export function isTaskChallengePendingReview(taskChallenge: unknown): boolean {
  if (!taskChallenge || typeof taskChallenge !== "object") return false;
  return (taskChallenge as { reviewStatus?: string }).reviewStatus === "pending";
}

export function canUserApproveTaskChallenges(
  user: { id?: string; role?: string } | null | undefined,
  rewards: RewardsSettings,
): boolean {
  const ids = rewards.taskChallenge.rewardManagerUserIds || [];
  const uid = String(user?.id || "").trim();
  if (ids.length > 0) {
    if (!uid) return false;
    return ids.includes(uid);
  }
  const r = String(user?.role || "").toUpperCase();
  if (isElevatedManagerRole(r)) return true;
  return r === "MANAGER";
}

export function buildTaskChallengeAttachment(input: {
  rewards: RewardsSettings;
  area: RewardWorkflowArea;
  task: string;
  customTasksRewardDefs: CustomTasksRewardDefs;
  logs: TaskLogLike[];
  normalizedMinutesPerPerson: number;
  user: { id?: string; rewardsEnrolled?: boolean; role?: string } | null | undefined;
  /** Cultivation: false when user declined. Other areas may pass true to keep one-tap logging. */
  optedIn: boolean;
  /** e.g. cultivation labor window closed and valid */
  laborGateOk: boolean;
  fallbackAvgMinutes?: number;
}): TaskChallengeLogAttachment | null {
  const {
    rewards,
    area,
    task,
    customTasksRewardDefs,
    logs,
    normalizedMinutesPerPerson,
    user,
    optedIn,
    laborGateOk,
    fallbackAvgMinutes = 45,
  } = input;

  if (!rewards.enabled || !rewards.taskChallenge.enabled || !optedIn || !laborGateOk) {
    return null;
  }

  if (isTaskExcludedFromChallenge(task, rewards.taskChallenge.excludedTaskSubstrings)) {
    return null;
  }
  if (area === "Cultivation" && String(task).trim() === "Print harvest sheet") {
    return null;
  }

  const rb = resolveConfigurableTaskRewards(area, task, customTasksRewardDefs);
  if (!rb.eligible) return null;

  if (!user || (!user.rewardsEnrolled && !isElevatedManagerRole(String(user.role || "")))) {
    return null;
  }

  if (!Number.isFinite(normalizedMinutesPerPerson) || normalizedMinutesPerPerson <= 0) {
    return null;
  }

  const tc = rewards.taskChallenge;
  const { avg, sampleCount } = computeAverageNormalizedMinutes(logs, area, task, {
    includeAreaInTaskKey: tc.includeAreaInTaskKey,
    lookbackDays: rewards.primaryWindowDays * 3,
  });
  const minSamples = tc.minSamplesForAverage;
  const effectiveAvg = sampleCount >= minSamples ? avg : null;
  const tier = scoreChallengeByLoggedMinutes(
    effectiveAvg,
    normalizedMinutesPerPerson,
    tc.tiers,
    fallbackAvgMinutes,
  );
  if (!tier) return null;

  const pts = Math.max(0, Math.round(tier.points * rb.tierMultiplier));
  const base: TaskChallengeLogAttachment = {
    proposedPoints: pts,
    pointsEarned: tc.requireManagerApproval ? 0 : pts,
    reviewStatus: tc.requireManagerApproval ? "pending" : "approved",
    tierLabel: tier.label,
    tierIndex: tier.tierIndex,
    targetMinutes: tier.targetMinutes,
    tierPointsMultiplier: rb.tierMultiplier,
    normalizedMinutesPerPerson,
    facilityAvgMinutes: effectiveAvg,
    facilitySampleCount: sampleCount,
  };

  return base;
}
