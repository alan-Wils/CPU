import type { RewardsSettings } from "./rewardsConfig";

export type LogLike = {
  area?: string;
  task?: string;
  output?: string;
  data?: {
    minutes?: unknown;
    people?: unknown;
    loggedBy?: { userId?: string; username?: string };
    taskChallenge?: { pointsEarned?: unknown };
  } | null;
  createdBy?: string | null;
  createdAt?: string;
};

function windowStartMs(days: number): number {
  return Date.now() - Math.max(1, days) * 86400000;
}

function logTimeMs(log: LogLike): number {
  const c = log.createdAt;
  if (c) {
    const t = Date.parse(String(c));
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

function actorKey(log: LogLike): string | null {
  const uid = log.data?.loggedBy?.userId;
  if (uid && String(uid).trim()) return `id:${String(uid).trim()}`;
  const u = log.data?.loggedBy?.username;
  if (u && String(u).trim()) return `u:${String(u).trim().toLowerCase()}`;
  if (log.createdBy && String(log.createdBy).trim()) return `c:${String(log.createdBy).trim()}`;
  return null;
}

function normMinutes(log: LogLike): number | null {
  const m = Number(log.data?.minutes);
  if (!Number.isFinite(m) || m < 0) return null;
  const p = Number(log.data?.people);
  const div = Number.isFinite(p) && p > 0 ? p : 1;
  return m / div;
}

function matchesTarget(task: string, targets: Record<string, number>): number | null {
  const t = String(task || "").trim();
  if (!t) return null;
  let best: { key: string; val: number } | null = null;
  for (const [key, val] of Object.entries(targets)) {
    if (!key.trim()) continue;
    if (t.toLowerCase().includes(key.toLowerCase())) {
      if (!best || key.length > best.key.length) best = { key, val };
    }
  }
  return best ? best.val : null;
}

export type IndividualRow = {
  key: string;
  displayName: string;
  totalPoints: number;
  breakdown: { fastTask: number; potency: number; yieldPts: number; taskChallenge: number };
};

export function buildRewardsSnapshot(input: {
  rewards: RewardsSettings;
  logs: LogLike[];
  dryFlowerBatches?: unknown[];
  enrolledUserKeys?: Set<string> | null;
  currentUserKeys?: string[];
}): {
  individuals: IndividualRow[];
  facilityTotalPoints: number;
  windowDays: number;
} {
  const { rewards, logs } = input;
  const enrolled = input.enrolledUserKeys;
  const windowDays = rewards.primaryWindowDays;
  const start = windowStartMs(windowDays);

  const filtered = logs.filter((l) => logTimeMs(l) >= start);

  const byActor = new Map<
    string,
    { displayName: string; breakdown: IndividualRow["breakdown"] }
  >();

  function ensureActor(key: string, displayName: string) {
    if (!byActor.has(key)) {
      byActor.set(key, {
        displayName,
        breakdown: { fastTask: 0, potency: 0, yieldPts: 0, taskChallenge: 0 },
      });
    }
    return byActor.get(key)!;
  }

  const targets = rewards.scoring.targetMinutesByTask || {};

  for (const log of filtered) {
    const key = actorKey(log);
    if (!key) continue;
    if (enrolled && enrolled.size > 0 && !enrolled.has(key)) continue;

    const name =
      String(log.data?.loggedBy?.username || "").trim() ||
      key.replace(/^id:|^u:|^c:/, "");
    const row = ensureActor(key, name || key);

    const nm = normMinutes(log);
    const task = String(log.task || "");
    if (nm != null) {
      const tgt = matchesTarget(task, targets);
      if (tgt != null && nm <= tgt + 1e-6) {
        row.breakdown.fastTask += rewards.scoring.fastTaskBonusPoints;
      }
    }

    const tcPts = Number(log.data?.taskChallenge?.pointsEarned);
    if (Number.isFinite(tcPts) && tcPts > 0) {
      row.breakdown.taskChallenge += tcPts;
    }
  }

  /** Potency: dry flower batches with finalLabPotencyPct in window — attribute via parent id unclear; skip individual, add facility tally */
  let potencyFacility = 0;
  const thresh = rewards.scoring.potencyThresholdPercent;
  const bonus = rewards.scoring.potencyBonusPoints;
  for (const b of input.dryFlowerBatches || []) {
    const row = b as Record<string, unknown>;
    const pct = Number(row.finalLabPotencyPct ?? row.labThcPct);
    const status = String(row.testStatus || "");
    if (status === "Test Passed" && Number.isFinite(pct) && pct >= thresh) {
      potencyFacility += bonus;
    }
  }

  const individuals: IndividualRow[] = [...byActor.entries()].map(([key, v]) => {
    const total =
      v.breakdown.fastTask +
      v.breakdown.potency +
      v.breakdown.yieldPts +
      v.breakdown.taskChallenge;
    return {
      key,
      displayName: v.displayName,
      totalPoints: total,
      breakdown: { ...v.breakdown },
    };
  });

  individuals.sort((a, b) => b.totalPoints - a.totalPoints);

  const facilityTotalPoints =
    individuals.reduce((s, i) => s + i.totalPoints, 0) + potencyFacility;

  return {
    individuals,
    facilityTotalPoints,
    windowDays,
  };
}

/** Resolve keys for current session user for leaderboard row match. */
export function keysForCurrentUser(user: {
  id?: string;
  username?: string;
  email?: string | null;
}): string[] {
  const out: string[] = [];
  if (user.id) out.push(`id:${user.id}`);
  const handle =
    String(user.username || "").trim() ||
    String(user.email || "")
      .split("@")[0]
      .trim();
  if (handle) out.push(`u:${handle.toLowerCase()}`);
  return out;
}

export type RewardPointEvent = {
  id: string;
  at: string | null;
  source: "fast_task" | "task_challenge";
  label: string;
  detail: string;
  points: number;
};

/** Per-log point sources for the signed-in user within the rewards window (for “where points came from”). */
export function listRewardEventsForUser(input: {
  rewards: RewardsSettings;
  logs: LogLike[];
  userKeys: string[];
  windowDays: number;
}): RewardPointEvent[] {
  const { rewards, logs, userKeys } = input;
  const keySet = new Set(userKeys);
  const start = windowStartMs(input.windowDays);
  const filtered = logs.filter((l) => logTimeMs(l) >= start);
  const targets = rewards.scoring.targetMinutesByTask || {};
  const events: RewardPointEvent[] = [];
  let n = 0;

  for (const log of filtered) {
    const k = actorKey(log);
    if (!k || !keySet.has(k)) continue;
    const task = String(log.task || "").trim() || "Task";

    const nm = normMinutes(log);
    if (nm != null) {
      const tgt = matchesTarget(task, targets);
      if (tgt != null && nm <= tgt + 1e-6) {
        events.push({
          id: `ft-${n++}`,
          at: log.createdAt ? String(log.createdAt) : null,
          source: "fast_task",
          label: "Fast task bonus",
          detail: task,
          points: rewards.scoring.fastTaskBonusPoints,
        });
      }
    }

    const tcPts = Number(log.data?.taskChallenge?.pointsEarned);
    if (Number.isFinite(tcPts) && tcPts > 0) {
      events.push({
        id: `tc-${n++}`,
        at: log.createdAt ? String(log.createdAt) : null,
        source: "task_challenge",
        label: "Task challenge",
        detail: task,
        points: tcPts,
      });
    }
  }

  events.sort((a, b) => {
    const ta = a.at ? Date.parse(a.at) : 0;
    const tb = b.at ? Date.parse(b.at) : 0;
    return tb - ta;
  });
  return events;
}
