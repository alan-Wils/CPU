/**
 * Maps dry-flower batches to UI workflow stages so the Cultivation page can render
 * stage cards (mirrors the extraction stage-card layout in `lib/extractionBatchUiStage.ts`).
 *
 * Routing rules mirror the dry-flower task gates in `app/cultivation/page.tsx`
 * (`dryTaskPrereqMessage` + `getBuckWholePlantLbs` / `getPreDeconFlowerLbs`).
 */

export type DryFlowerUiStageKey = "trim" | "cure" | "testing" | "packaging";

export const DRY_FLOWER_UI_STAGE_ORDER: DryFlowerUiStageKey[] = [
  "trim",
  "cure",
  "testing",
  "packaging",
];

export const DRY_FLOWER_UI_STAGE_META: Record<
  DryFlowerUiStageKey,
  { label: string; helper: string }
> = {
  trim: {
    label: "Buck / Trim",
    helper: "Bucking whole plant, then sorting A-grade, popcorn, and trim.",
  },
  cure: {
    label: "Decon / Cure",
    helper: "Decontamination kill, then burping/curing in jars.",
  },
  testing: {
    label: "Lab Testing",
    helper: "Submitted to the lab, awaiting potency and compliance results.",
  },
  packaging: {
    label: "Ready to Package",
    helper: "Test Passed — package A-grade and popcorn until remaining hits zero.",
  },
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function getBuckWholePlantLbs(batch: any): number {
  if (!batch) return 0;
  const w = num(batch?.buckWholePlantLbs);
  if (w > 0) return w;
  return num(batch?.buckedWeightLbs);
}

function getPreDeconFlowerLbs(batch: any): number {
  return num(batch?.trimmedWeightLbs) + num(batch?.popcornWeightLbs);
}

function getDeconLbs(batch: any): number {
  return num(batch?.deconWeightLbs);
}

function getRemainingPackableLbs(batch: any): number {
  return num(batch?.remainingPackableLbs);
}

/**
 * Most-progressed wins. Mirrors `extractionUiStageFromBatch` cascading-gate pattern.
 *
 * Note: callers should already exclude `status === "Complete"` — those belong in the
 * Production / Completed Outputs panel, not in the active dry-flower stage cards.
 */
export function dryFlowerUiStageFromBatch(batch: any): DryFlowerUiStageKey {
  const testStatus = String(batch?.testStatus || "");
  const status = String(batch?.status || "");

  if (testStatus === "Test Passed") return "packaging";
  if (testStatus === "Submitted to Testing" || testStatus === "Test Failed") {
    return "testing";
  }
  if (getDeconLbs(batch) > 0 || status === "Burping") return "cure";
  return "trim";
}

export function groupActiveDryFlowerBatchesByUiStage(
  activeBatches: any[],
): Record<DryFlowerUiStageKey, any[]> {
  const out: Record<DryFlowerUiStageKey, any[]> = {
    trim: [],
    cure: [],
    testing: [],
    packaging: [],
  };
  for (const b of activeBatches) {
    out[dryFlowerUiStageFromBatch(b)].push(b);
  }
  return out;
}

/** Stage-specific quantity-of-interest (lbs) shown on each stage card. */
export function dryFlowerStageQuantityLbs(
  stageKey: DryFlowerUiStageKey,
  batches: any[],
): number {
  let total = 0;
  for (const b of batches) {
    if (stageKey === "trim") total += getBuckWholePlantLbs(b);
    else if (stageKey === "cure") total += getPreDeconFlowerLbs(b);
    else if (stageKey === "testing") total += getDeconLbs(b);
    else if (stageKey === "packaging") total += getRemainingPackableLbs(b);
  }
  return total;
}

export function dryFlowerStageQuantityLabel(stageKey: DryFlowerUiStageKey): string {
  if (stageKey === "trim") return "Whole-plant lbs (buck)";
  if (stageKey === "cure") return "Trimmed flower lbs";
  if (stageKey === "testing") return "Decon lbs at lab";
  return "Remaining packable lbs";
}

export function formatDryFlowerStageLbs(value: number): string {
  if (!Number.isFinite(value)) return "0 lbs";
  const rounded = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);
  // Trim trailing ".00" / ".X0" but keep significant digits.
  const trimmed = rounded.replace(/\.00$/, "").replace(/(\.\d*?)0+$/, "$1");
  return `${trimmed} lbs`;
}
