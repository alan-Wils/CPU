/** Rolling average of normalized minutes for matching task logs. */

export type TaskLogLike = {
  area?: string;
  task?: string;
  data?: { minutes?: unknown; people?: unknown } | null;
};

function normMinutes(log: TaskLogLike): number | null {
  const m = Number(log.data?.minutes);
  if (!Number.isFinite(m) || m <= 0) return null;
  const p = Number(log.data?.people);
  const div = Number.isFinite(p) && p > 0 ? p : 1;
  return m / div;
}

export function taskKeyForChallenge(
  area: string,
  task: string,
  includeArea: boolean,
): string {
  const a = String(area || "").trim();
  const t = String(task || "").trim();
  return includeArea ? `${a}::${t}` : t;
}

export function computeAverageNormalizedMinutes(
  logs: TaskLogLike[],
  area: string,
  task: string,
  opts: { includeAreaInTaskKey: boolean; lookbackDays?: number },
): { avg: number | null; sampleCount: number } {
  const key = taskKeyForChallenge(area, task, opts.includeAreaInTaskKey);
  const cutoff =
    opts.lookbackDays != null
      ? Date.now() - opts.lookbackDays * 86400000
      : 0;

  const values: number[] = [];
  for (const log of logs) {
    const created = (log as { createdAt?: string }).createdAt;
    if (created && cutoff > 0) {
      const ts = Date.parse(String(created));
      if (Number.isFinite(ts) && ts < cutoff) continue;
    }
    const nk = taskKeyForChallenge(
      String(log.area || ""),
      String(log.task || ""),
      opts.includeAreaInTaskKey,
    );
    if (nk !== key) continue;
    const n = normMinutes(log);
    if (n != null) values.push(n);
  }

  if (values.length === 0) return { avg: null, sampleCount: 0 };
  const sum = values.reduce((a, b) => a + b, 0);
  return { avg: sum / values.length, sampleCount: values.length };
}

export type TierResult = {
  tierIndex: number;
  label: string;
  points: number;
  targetMinutes: number;
};

export function scoreChallengeByLoggedMinutes(
  avgMinutes: number | null,
  normalizedMinutesLogged: number,
  tiers: { label: string; multiplierVsAvg: number; points: number }[],
  fallbackAvg: number,
): TierResult | null {
  const base = avgMinutes != null && avgMinutes > 0 ? avgMinutes : fallbackAvg;
  if (!Number.isFinite(base) || base <= 0) return null;

  const qualifying = tiers
    .map((t, tierIndex) => ({
      tierIndex,
      label: t.label,
      points: t.points,
      targetMinutes: base * t.multiplierVsAvg,
    }))
    .filter((t) => normalizedMinutesLogged <= t.targetMinutes + 1e-6)
    .sort((a, b) => b.points - a.points);

  const top = qualifying[0];
  return top ?? null;
}
