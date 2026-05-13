import type { CultivationConfigurableTask } from "@/lib/customTasksConfig";
import {
  TASK_CREATE_IMMATURE_PLANT_BATCH,
  TASK_MOVE_TO_VEG,
  TASK_MOVE_TO_VEG_ASSIGN_TAGS,
} from "@/lib/cultivationMetrcWorkflow";

/** Default clone tasks when METRC integration is enabled (matches cultivation page). */
export const DEFAULT_CLONE_TASKS_METRC = [
  "Maintenance",
  "Feed",
  "Burp",
  "Fill Pots",
  "Combine Batches",
  TASK_CREATE_IMMATURE_PLANT_BATCH,
  TASK_MOVE_TO_VEG_ASSIGN_TAGS,
] as const;

/** Default clone tasks when METRC integration is off. */
export const DEFAULT_CLONE_TASKS_NO_METRC = [
  "Maintenance",
  "Feed",
  "Burp",
  "Fill Pots",
  "Combine Batches",
  TASK_MOVE_TO_VEG,
] as const;

export const DEFAULT_VEG_TASKS = [
  "Set Irrigation Up",
  "Plant Work",
  "Add METRC Tags",
  "IPM",
  "Combine Batches",
  "Move to Flower",
] as const;

export const DEFAULT_FLOWER_TASKS = [
  "Set Irrigation Up",
  "Trellis",
  "Plant Work",
  "IPM",
  "Combine Batches",
  "Print harvest sheet",
  "Harvest",
  "Finish batch",
] as const;

/** Select this value to type a one-off calendar title not in the static list. */
export const SCHEDULE_TEMPLATE_TASK_CUSTOM = "__custom__";

/**
 * Built-in + configured custom cultivation task names for the schedule-template picker
 * (Admin → Company config → automatic calendar tasks).
 */
export function listStaticCultivationTasksForSchedulePicker(
  stage: "clone" | "veg" | "flower",
  metrcIntegrationEnabled: boolean,
  customTasks: CultivationConfigurableTask[] | undefined,
): string[] {
  const base =
    stage === "clone"
      ? [...(metrcIntegrationEnabled ? DEFAULT_CLONE_TASKS_METRC : DEFAULT_CLONE_TASKS_NO_METRC)]
      : stage === "veg"
        ? [...DEFAULT_VEG_TASKS]
        : [...DEFAULT_FLOWER_TASKS];
  const extras = (customTasks || [])
    .filter((r) => String(r.label || "").trim())
    .filter((r) => {
      const st = r.stages || [];
      if (!st.length) return true;
      return st.includes(stage);
    })
    .map((r) => String(r.label).trim());
  const out = new Set<string>();
  for (const t of base) out.add(t);
  for (const t of extras) out.add(t);
  return [...out].sort((a, b) => a.localeCompare(b));
}

export function scheduleTemplateTitleSelectValue(title: string, options: string[]): string {
  const t = String(title || "").trim();
  if (t && options.includes(t)) return t;
  return SCHEDULE_TEMPLATE_TASK_CUSTOM;
}
