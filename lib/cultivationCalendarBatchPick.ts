/** Aligns with `stageBucketFromBatchStage` on the cultivation page — maps UI stage string to calendar groups. */
export type CultivationCalendarStageGroup = "clone" | "veg" | "flower";

export type CultivationBatchCalendarPickRow = {
  id: string;
  stage: unknown;
  strain?: string;
  plants?: unknown;
};

export function cultivationCalendarStageGroup(stage: unknown): CultivationCalendarStageGroup {
  const value = String(stage || "").trim().toLowerCase();
  if (value === "clone" || value === "clones") return "clone";
  if (value === "veg") return "veg";
  return "flower";
}

function numPlants(batch: CultivationBatchCalendarPickRow): number {
  const n = Number(batch.plants);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** One-line label for dropdowns: easy to scan strain, plant count, and id. */
export function formatCultivationBatchCalendarOptionLabel(batch: CultivationBatchCalendarPickRow): string {
  const strain = String(batch.strain || "").trim() || "—";
  const plants = numPlants(batch);
  const plantSeg = plants > 0 ? ` · ${plants} plants` : "";
  const shortId = batch.id.length > 10 ? `${batch.id.slice(0, 8)}…` : batch.id;
  return `${strain}${plantSeg} · ${shortId}`;
}

const GROUP_ORDER: CultivationCalendarStageGroup[] = ["clone", "veg", "flower"];

const GROUP_LABEL: Record<CultivationCalendarStageGroup, string> = {
  clone: "Clone",
  veg: "Veg",
  flower: "Flower",
};

export function groupCultivationBatchesForCalendarPicker(
  batches: CultivationBatchCalendarPickRow[],
): { group: CultivationCalendarStageGroup; label: string; batches: CultivationBatchCalendarPickRow[] }[] {
  const by: Record<CultivationCalendarStageGroup, CultivationBatchCalendarPickRow[]> = {
    clone: [],
    veg: [],
    flower: [],
  };
  for (const b of batches) {
    const id = String(b?.id || "").trim();
    if (!id) continue;
    by[cultivationCalendarStageGroup(b.stage)].push(b);
  }
  const sortFn = (a: CultivationBatchCalendarPickRow, b: CultivationBatchCalendarPickRow) =>
    formatCultivationBatchCalendarOptionLabel(a).localeCompare(formatCultivationBatchCalendarOptionLabel(b));
  for (const k of GROUP_ORDER) by[k].sort(sortFn);
  return GROUP_ORDER.map((group) => ({
    group,
    label: GROUP_LABEL[group],
    batches: by[group],
  })).filter((g) => g.batches.length > 0);
}
