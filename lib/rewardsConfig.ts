/** Parsed company.settings.rewards from CompanyConfig JSON. */

export type RewardItemConfig = {
  id: string;
  label: string;
  pointsRequired: number;
};

export type TaskChallengeTierConfig = {
  label: string;
  multiplierVsAvg: number;
  points: number;
};

export type RewardsSettings = {
  enabled: boolean;
  primaryWindowDays: number;
  scoring: {
    fastTaskBonusPoints: number;
    targetMinutesByTask: Record<string, number>;
    potencyThresholdPercent: number;
    potencyBonusPoints: number;
    yieldBonusPoints: number;
  };
  rewardItems: RewardItemConfig[];
  taskChallenge: {
    enabled: boolean;
    minSamplesForAverage: number;
    includeAreaInTaskKey: boolean;
    tiers: TaskChallengeTierConfig[];
  };
};

const defaultScoring = {
  fastTaskBonusPoints: 5,
  targetMinutesByTask: {} as Record<string, number>,
  potencyThresholdPercent: 20,
  potencyBonusPoints: 15,
  yieldBonusPoints: 10,
};

const defaultTaskChallengeTiers: TaskChallengeTierConfig[] = [
  { label: "Fast", multiplierVsAvg: 0.85, points: 30 },
  { label: "On target", multiplierVsAvg: 1, points: 20 },
  { label: "Stretch", multiplierVsAvg: 1.15, points: 10 },
];

export function parseRewardsSettings(raw: unknown): RewardsSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const scoring = o.scoring && typeof o.scoring === "object" ? (o.scoring as Record<string, unknown>) : {};
  const tc = o.taskChallenge && typeof o.taskChallenge === "object" ? (o.taskChallenge as Record<string, unknown>) : {};
  const tiersRaw = Array.isArray(tc.tiers) ? tc.tiers : [];
  const tiers = tiersRaw
    .map((t) => {
      const x = t as Record<string, unknown>;
      return {
        label: String(x.label ?? "Tier"),
        multiplierVsAvg: Number(x.multiplierVsAvg),
        points: Number(x.points),
      };
    })
    .filter((t) => Number.isFinite(t.multiplierVsAvg) && Number.isFinite(t.points));

  const rewardItemsRaw = Array.isArray(o.rewardItems) ? o.rewardItems : [];
  const rewardItems = rewardItemsRaw
    .map((r) => {
      const x = r as Record<string, unknown>;
      return {
        id: String(x.id ?? "").trim() || `ri-${Math.random().toString(36).slice(2)}`,
        label: String(x.label ?? ""),
        pointsRequired: Number(x.pointsRequired),
      };
    })
    .filter((r) => r.label && Number.isFinite(r.pointsRequired));

  return {
    enabled: Boolean(o.enabled),
    primaryWindowDays: Math.max(1, Number(o.primaryWindowDays) || 30),
    scoring: {
      fastTaskBonusPoints: Number(scoring.fastTaskBonusPoints) || defaultScoring.fastTaskBonusPoints,
      targetMinutesByTask:
        scoring.targetMinutesByTask && typeof scoring.targetMinutesByTask === "object"
          ? (scoring.targetMinutesByTask as Record<string, number>)
          : { ...defaultScoring.targetMinutesByTask },
      potencyThresholdPercent:
        Number(scoring.potencyThresholdPercent) || defaultScoring.potencyThresholdPercent,
      potencyBonusPoints: Number(scoring.potencyBonusPoints) || defaultScoring.potencyBonusPoints,
      yieldBonusPoints: Number(scoring.yieldBonusPoints) || defaultScoring.yieldBonusPoints,
    },
    rewardItems,
    taskChallenge: {
      enabled: tc.enabled !== undefined ? Boolean(tc.enabled) : true,
      minSamplesForAverage: Math.max(1, Number(tc.minSamplesForAverage) || 5),
      includeAreaInTaskKey: tc.includeAreaInTaskKey !== undefined ? Boolean(tc.includeAreaInTaskKey) : true,
      tiers: tiers.length > 0 ? tiers : defaultTaskChallengeTiers,
    },
  };
}

export function extractRewardsFromCompanyConfig(config: unknown): RewardsSettings {
  const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
  const settings = c.company && typeof c.company === "object" ? (c.company as Record<string, unknown>).settings : {};
  const s = settings && typeof settings === "object" ? (settings as Record<string, unknown>) : {};
  return parseRewardsSettings(s.rewards);
}
