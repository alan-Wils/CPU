/**
 * METRC-aligned cultivation helpers: immature plant batches (grouped clone stage)
 * vs individual plant tags (veg transition).
 *
 * When `GET /api/metrc/available-plant-tags` returns ordered labels, operators can assign
 * that slice directly. Otherwise sequential tags are derived from the first METRC-style tag string.
 */

export const TASK_CREATE_IMMATURE_PLANT_BATCH = "Create Immature Plant Batch";

/** Current UI label for Clone → Veg transition with METRC tag assignment. */
export const TASK_MOVE_TO_VEG_ASSIGN_TAGS = "Move to Veg / Assign Plant Tags";

/**
 * Clone → Veg when company METRC integration is disabled: no immature batch or tag workflow.
 */
export const TASK_MOVE_TO_VEG = "Move to Veg";

/** Veg → Flower transition (calendar anchor for flower-stage schedule templates). */
export const TASK_MOVE_TO_FLOWER = "Move to Flower";

/** Legacy task name kept for log matching and backwards compatibility. */
export const LEGACY_TASK_CLONE_TO_VEG = "Clone → Veg";

export type MetrcImmatureSyncStatus = "Not Synced" | "Ready to Sync" | "Synced" | "Failed";

export type ImmaturePlantBatch = {
  id: string;
  cultivationBatchId: string;
  name: string;
  strain: string;
  countOriginal: number;
  countAvailable: number;
  location: string;
  sublocation?: string;
  plantDate: string;
  sourceType?: "clone" | "seed" | "mother" | "other" | string;
  notes?: string;
  metrcBatchId?: string;
  metrcSyncStatus: MetrcImmatureSyncStatus;
  createdAt: string;
  updatedAt: string;
};

/** Individual plant row after assigning METRC tags at veg transition. */
export type CultivationPlantRecord = {
  id: string;
  cultivationBatchId: string;
  immaturePlantBatchId: string;
  tag: string;
  strain: string;
  stage: string;
  location: string;
  sublocation?: string;
  status: string;
  metrcPlantId?: string;
  createdAt: string;
  updatedAt: string;
};

/** Prepared METRC-style payload (stored locally; no live API call here). */
export type MetrcVegMovePayloadItem = {
  Name: string;
  Count: number;
  StartingTag: string;
  GrowthPhase: "Vegetative";
  NewLocation: string;
  NewSublocation: string | null;
  GrowthDate: string;
  PatientLicenseNumber: null;
};

/** METRC-style veg move (immature batch + tag assignment). */
export function isMetrcVegTagMoveTask(taskName: string): boolean {
  const t = String(taskName || "").trim();
  return t === TASK_MOVE_TO_VEG_ASSIGN_TAGS || t === LEGACY_TASK_CLONE_TO_VEG;
}

/** Any Clone → Veg transition task (METRC or simple). */
export function isAnyMoveToVegTask(taskName: string): boolean {
  const t = String(taskName || "").trim();
  return isMetrcVegTagMoveTask(t) || t === TASK_MOVE_TO_VEG;
}

/** @deprecated Prefer isMetrcVegTagMoveTask or isAnyMoveToVegTask for new code. */
export function isMoveToVegTaskName(taskName: string): boolean {
  return isMetrcVegTagMoveTask(taskName);
}

export function generateMetrcTagSequence(
  firstTag: string,
  count: number,
): { ok: true; tags: string[] } | { ok: false; error: string } {
  const trimmed = String(firstTag || "").trim();
  if (!trimmed) return { ok: false, error: "Starting METRC plant tag is required." };
  if (!(Number.isFinite(count) && count >= 1)) {
    return { ok: false, error: "Number of plants / tags must be at least 1." };
  }

  const m = trimmed.match(/^(.*?)(\d+)$/);
  if (!m) {
    return {
      ok: false,
      error: "Tag must end with a numeric suffix so the sequence can increment (preserve prefix and digit width).",
    };
  }

  const prefix = m[1];
  const digitStr = m[2];
  const width = digitStr.length;

  let base: bigint;
  try {
    base = BigInt(digitStr);
  } catch {
    return { ok: false, error: "Invalid numeric suffix on tag." };
  }

  const tags: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < count; i++) {
    const n = base + BigInt(i);
    const ns = n.toString();
    if (ns.length > width) {
      return {
        ok: false,
        error: `Tag sequence overflows the fixed ${width}-digit width at step ${i + 1}.`,
      };
    }
    const padded = ns.padStart(width, "0");
    const tag = `${prefix}${padded}`;
    if (seen.has(tag)) return { ok: false, error: "Duplicate tags in generated sequence." };
    seen.add(tag);
    tags.push(tag);
  }

  return { ok: true, tags };
}

/** Prefer consecutive labels from METRC available-tag inventory when enough were fetched. */
export function resolveMoveToVegPlantTags(params: {
  moveCount: number;
  inventoryTags: string[] | null | undefined;
  firstTagManual: string;
}):
  | { ok: true; tags: string[]; source: "metrc_inventory" | "local_sequence" }
  | { ok: false; error: string } {
  const n = Number(params.moveCount);
  if (!Number.isFinite(n) || n < 1) {
    return { ok: false, error: "Number of plants / tags must be at least 1." };
  }

  const inv = Array.isArray(params.inventoryTags) ? params.inventoryTags : [];
  if (inv.length >= n) {
    const slice = inv.slice(0, n);
    if (new Set(slice).size !== slice.length) {
      return {
        ok: false,
        error: "Fetched METRC tag list contains duplicates in the requested range — refresh from METRC.",
      };
    }
    return { ok: true, tags: slice, source: "metrc_inventory" };
  }

  const seq = generateMetrcTagSequence(params.firstTagManual.trim(), n);
  if (!seq.ok) return seq;
  return { ok: true, tags: seq.tags, source: "local_sequence" };
}

export function buildMetrcVegMovePayload(params: {
  immatureBatchName: string;
  countMovingToVeg: number;
  startingTag: string;
  newLocationLabel: string;
  newSublocation?: string;
  growthDateYmd: string;
}): MetrcVegMovePayloadItem[] {
  const sub = String(params.newSublocation || "").trim();
  return [
    {
      Name: params.immatureBatchName,
      Count: params.countMovingToVeg,
      StartingTag: params.startingTag,
      GrowthPhase: "Vegetative",
      NewLocation: params.newLocationLabel,
      NewSublocation: sub.length ? sub : null,
      GrowthDate: params.growthDateYmd,
      PatientLicenseNumber: null,
    },
  ];
}

/** Collect all existing plant tag strings from active cultivation batches (company store slice). */
export function collectExistingPlantTagsFromCultivationBatches(
  batches: unknown[],
  excludeCultivationBatchId?: string,
): Set<string> {
  const set = new Set<string>();
  for (const b of Array.isArray(batches) ? batches : []) {
    const row = b as Record<string, unknown>;
    const id = String(row?.id || "");
    if (excludeCultivationBatchId && id === excludeCultivationBatchId) continue;
    const records = row?.plantTagRecords;
    if (!Array.isArray(records)) continue;
    for (const r of records) {
      const tag = String((r as { tag?: string })?.tag || "").trim();
      if (tag) set.add(tag);
    }
  }
  return set;
}

export function findOverlappingTags(
  generatedTags: string[],
  existing: Set<string>,
): string[] {
  const out: string[] = [];
  for (const t of generatedTags) {
    if (existing.has(t)) out.push(t);
  }
  return out;
}

export function sumImmatureAvailableExcluding(
  immatureList: unknown[] | undefined,
  excludeImmatureId: string,
): number {
  if (!Array.isArray(immatureList)) return 0;
  let sum = 0;
  for (const x of immatureList) {
    const row = x as { id?: string; countAvailable?: unknown };
    if (String(row?.id || "") === excludeImmatureId) continue;
    const n = Number(row?.countAvailable);
    if (Number.isFinite(n) && n > 0) sum += n;
  }
  return sum;
}

export function allImmatureDepletedAfterMove(
  immatureList: unknown[] | undefined,
  immatureId: string,
  subtract: number,
): boolean {
  if (!Array.isArray(immatureList) || immatureList.length === 0) return false;
  const next = immatureList.map((x) => {
    const row = x as { id?: string; countAvailable?: unknown };
    if (String(row?.id || "") !== immatureId) return row;
    const avail = Number(row?.countAvailable);
    const v = Number.isFinite(avail) ? avail : 0;
    return { ...row, countAvailable: Math.max(0, v - subtract) };
  });
  return next.every((row) => {
    const n = Number((row as { countAvailable?: unknown }).countAvailable);
    return !Number.isFinite(n) || n <= 0;
  });
}
