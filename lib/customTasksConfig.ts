/** Company-configured extra tasks (per workflow area) + reward overrides. */

export type RewardWorkflowArea = "Cultivation" | "Extraction" | "Packaging";

export type CultivationCustomTaskStage = "clone" | "veg" | "flower";

export type ConfigurableTaskDefinition = {
  id: string;
  /** Display name / log task string — must match exactly for rewards lookup. */
  label: string;
  /** When false, fast-task bonus and task-challenge points are skipped for this task in this area. */
  rewardsEligible: boolean;
  /**
   * Multiplier applied to tier challenge points after tier selection (e.g. 1 = default, 2 = double, 0 = none).
   * Fast-task bonus points use the global setting and are not multiplied.
   */
  tierPointsMultiplier: number;
};

export type CultivationConfigurableTask = ConfigurableTaskDefinition & {
  /** Which cultivation task lists include this label. Empty = all three. */
  stages: CultivationCustomTaskStage[];
};

function clampMultiplier(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 1;
  return Math.min(n, 100);
}

export function normalizeConfigurableTaskDefinition(raw: unknown): ConfigurableTaskDefinition | null {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  let id = String(o.id ?? "").trim();
  if (!id) id = `ct-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const label = String(o.label ?? "").trim();
  if (!label) return null;
  const rewardsEligible = o.rewardsEligible !== undefined ? Boolean(o.rewardsEligible) : true;
  const tm = Number(o.tierPointsMultiplier);
  const tierPointsMultiplier = Number.isFinite(tm) ? clampMultiplier(tm) : 1;
  return { id, label, rewardsEligible, tierPointsMultiplier };
}

export function normalizeCultivationConfigurableTask(raw: unknown): CultivationConfigurableTask | null {
  const base = normalizeConfigurableTaskDefinition(raw);
  if (!base) return null;
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const stagesRaw = o.stages;
  let stages: CultivationCustomTaskStage[] = [];
  if (Array.isArray(stagesRaw)) {
    for (const s of stagesRaw) {
      const x = String(s || "").toLowerCase();
      if (x === "clone" || x === "veg" || x === "flower") stages.push(x);
    }
  }
  return { ...base, stages };
}

export function normalizeConfigurableTaskList(raw: unknown): ConfigurableTaskDefinition[] {
  if (!Array.isArray(raw)) return [];
  const out: ConfigurableTaskDefinition[] = [];
  for (const item of raw) {
    const n = normalizeConfigurableTaskDefinition(item);
    if (n) out.push(n);
  }
  return out;
}

export function normalizeCultivationCustomTaskList(raw: unknown): CultivationConfigurableTask[] {
  if (!Array.isArray(raw)) return [];
  const out: CultivationConfigurableTask[] = [];
  for (const item of raw) {
    const n = normalizeCultivationConfigurableTask(item);
    if (n) out.push(n);
  }
  return out;
}

export type CustomTasksRewardDefs = {
  cultivation: CultivationConfigurableTask[];
  extraction: ConfigurableTaskDefinition[];
  packaging: ConfigurableTaskDefinition[];
};

export function extractCustomTasksRewardDefsFromCompanyConfig(config: unknown): CustomTasksRewardDefs {
  const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
  const cult = c.cultivation && typeof c.cultivation === "object" ? (c.cultivation as Record<string, unknown>) : {};
  const ext = c.extraction && typeof c.extraction === "object" ? (c.extraction as Record<string, unknown>) : {};
  const pkg = c.packaging && typeof c.packaging === "object" ? (c.packaging as Record<string, unknown>) : {};
  return {
    cultivation: normalizeCultivationCustomTaskList(cult.customTasks),
    extraction: normalizeConfigurableTaskList(ext.customTasks),
    packaging: normalizeConfigurableTaskList(pkg.customTasks),
  };
}

/**
 * Resolve reward behavior for a task name in an area.
 * Built-in tasks (not listed in customTasks) default to eligible with multiplier 1.
 */
export function resolveConfigurableTaskRewards(
  area: RewardWorkflowArea,
  taskName: string,
  defs: CustomTasksRewardDefs,
): { eligible: boolean; tierMultiplier: number } {
  const t = String(taskName || "").trim();
  if (!t) return { eligible: true, tierMultiplier: 1 };

  let match: ConfigurableTaskDefinition | undefined;

  if (area === "Cultivation") {
    match = defs.cultivation.find((d) => d.label === t);
  } else if (area === "Extraction") {
    match = defs.extraction.find((d) => d.label === t);
  } else {
    match = defs.packaging.find((d) => d.label === t);
  }

  if (!match) return { eligible: true, tierMultiplier: 1 };

  return {
    eligible: match.rewardsEligible,
    tierMultiplier: clampMultiplier(match.tierPointsMultiplier),
  };
}

export function mergeCultivationTasksForStage(
  defaults: string[],
  customs: CultivationConfigurableTask[],
  stage: CultivationCustomTaskStage,
): string[] {
  const extra = customs
    .filter((c) => c.stages.length === 0 || c.stages.includes(stage))
    .map((c) => c.label.trim())
    .filter(Boolean);
  const seen = new Set(defaults.map((x) => String(x)));
  const out = [...defaults];
  for (const e of extra) {
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

export function mergeWorkflowTaskList(defaults: string[], customs: ConfigurableTaskDefinition[]): string[] {
  const extra = customs.map((c) => c.label.trim()).filter(Boolean);
  const seen = new Set(defaults.map((x) => String(x)));
  const out = [...defaults];
  for (const e of extra) {
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}
