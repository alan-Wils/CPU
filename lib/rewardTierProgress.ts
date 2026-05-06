import type { RewardItemConfig } from "./rewardsConfig";

export type NextRewardProgress = {
  nextItem: { label: string; pointsRequired: number } | null;
  pointsAway: number | null;
  allComplete: boolean;
};

export function getNextRewardProgress(
  totalPoints: number,
  rewardItems: RewardItemConfig[],
): NextRewardProgress {
  if (!rewardItems.length) {
    return { nextItem: null, pointsAway: null, allComplete: false };
  }
  const sorted = [...rewardItems].sort((a, b) => a.pointsRequired - b.pointsRequired);
  const next = sorted.find((r) => totalPoints < r.pointsRequired);
  if (!next) {
    return { nextItem: null, pointsAway: null, allComplete: true };
  }
  const pointsAway = Math.max(0, next.pointsRequired - totalPoints);
  return {
    nextItem: { label: next.label, pointsRequired: next.pointsRequired },
    pointsAway,
    allComplete: false,
  };
}
