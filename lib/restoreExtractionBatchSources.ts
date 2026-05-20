import { getValidatedCombinedPartnerIds } from "@/lib/extractionMergeHelpers";
import { GRAMS_PER_LB } from "@/lib/freshFrozenPackageDisplay";
import { getSourceAvailable, getSourceOriginalLbs } from "@/lib/sourceBatchActive";
import { syncProductionBatchesFromFfTrimSources } from "@/lib/syncSourceBatchesToStore";
import { num } from "@/lib/weightUnits";

const RESTORE_EPSILON_LBS = 0.02;

export type ExtractionStoreSlice = {
  sourceBatches: unknown[];
  completedSourceBatches: unknown[];
  productionBatches?: unknown[];
};

export type SourceRestorePlan = {
  sourceId: string;
  amountUsedLbs: number;
  updatedSource: Record<string, unknown>;
  fromCompleted: boolean;
};

function batchSources(batch: unknown): Record<string, unknown>[] {
  if (!batch || typeof batch !== "object") return [];
  const sources = (batch as { sources?: unknown }).sources;
  if (!Array.isArray(sources)) return [];
  return sources.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"));
}

/** True when batch was just created (no tasks, no merge) and still has source usage to reverse. */
export function extractionBatchCanRestoreSources(
  batch: unknown,
  activeExtractionBatches: unknown[] = [],
  completedExtractionBatches: unknown[] = [],
): boolean {
  if (!batch || typeof batch !== "object") return false;
  const b = batch as Record<string, unknown>;
  if (b.mergedIntoBatchId) return false;

  const tasks = Array.isArray(b.completedTasks) ? b.completedTasks : [];
  if (tasks.length > 0) return false;

  const partners = getValidatedCombinedPartnerIds(
    batch,
    activeExtractionBatches,
    completedExtractionBatches,
  );
  if (partners.length > 0) return false;

  return batchSources(batch).some((row) => {
    const sourceId = String(row.sourceId || "").trim();
    return Boolean(sourceId) && num(row.amountUsed) > 0;
  });
}

/** Remaining lbs for undoing extraction usage (handles Complete / Used rows with 0 remaining). */
function currentRemainingLbsForRestore(row: Record<string, unknown>): number {
  if (row.remainingAmount !== undefined) {
    const remaining = num(row.remainingAmount);
    const status = String(row.status || "")
      .trim()
      .toLowerCase();
    if (
      remaining <= 0 &&
      (status === "used in extraction" ||
        status === "complete" ||
        status.includes("complete"))
    ) {
      return 0;
    }
    if (remaining > 0) return +remaining.toFixed(4);
    return 0;
  }
  return getSourceAvailable(row);
}

function locateSourceInStore(
  store: ExtractionStoreSlice,
  sourceId: string,
): { row: Record<string, unknown>; fromCompleted: boolean; index: number } | null {
  const active = store.sourceBatches || [];
  for (let i = 0; i < active.length; i++) {
    const row = active[i];
    if (!row || typeof row !== "object") continue;
    if (String((row as { id?: unknown }).id || "") === sourceId) {
      return { row: row as Record<string, unknown>, fromCompleted: false, index: i };
    }
  }

  const completed = store.completedSourceBatches || [];
  for (let i = 0; i < completed.length; i++) {
    const row = completed[i];
    if (!row || typeof row !== "object") continue;
    if (String((row as { id?: unknown }).id || "") === sourceId) {
      return { row: row as Record<string, unknown>, fromCompleted: true, index: i };
    }
  }

  return null;
}

export function buildExtractionBatchSourceRestorePlans(
  batch: unknown,
  store: ExtractionStoreSlice,
): SourceRestorePlan[] {
  const plans: SourceRestorePlan[] = [];

  for (const row of batchSources(batch)) {
    const sourceId = String(row.sourceId || "").trim();
    const amountUsedLbs = num(row.amountUsed);
    if (!sourceId || amountUsedLbs <= 0) continue;

    const located = locateSourceInStore(store, sourceId);
    if (!located) continue;

    const original = getSourceOriginalLbs(located.row);
    const current = currentRemainingLbsForRestore(located.row);
    const restoredRemaining = +(current + amountUsedLbs).toFixed(4);
    const capped =
      original > 0
        ? Math.min(restoredRemaining, +original.toFixed(4))
        : restoredRemaining;

    let status: string;
    if (original > 0 && capped >= original - RESTORE_EPSILON_LBS) {
      status = "Available for Extraction";
    } else if (capped > RESTORE_EPSILON_LBS) {
      status = "Partially Used in Extraction";
    } else {
      status = "Used in Extraction";
    }

    const updatedSource: Record<string, unknown> = {
      ...located.row,
      remainingAmount: +capped.toFixed(4),
      status,
    };
    delete updatedSource.completedAt;

    plans.push({
      sourceId,
      amountUsedLbs,
      updatedSource,
      fromCompleted: located.fromCompleted,
    });
  }

  return plans;
}

export function applyExtractionBatchSourceRestorePlansToStore(
  store: ExtractionStoreSlice,
  plans: SourceRestorePlan[],
): void {
  if (!plans.length) return;

  for (const plan of plans) {
    const located = locateSourceInStore(store, plan.sourceId);

    if (located?.fromCompleted) {
      store.completedSourceBatches.splice(located.index, 1);
      const activeIdx = (store.sourceBatches || []).findIndex(
        (row) =>
          row &&
          typeof row === "object" &&
          String((row as { id?: unknown }).id || "") === plan.sourceId,
      );
      if (activeIdx >= 0) {
        Object.assign(store.sourceBatches[activeIdx] as object, plan.updatedSource);
      } else {
        store.sourceBatches.unshift(plan.updatedSource);
      }
      continue;
    }

    if (located) {
      Object.assign(located.row, plan.updatedSource);
      continue;
    }

    store.sourceBatches.unshift(plan.updatedSource);
  }

  syncProductionBatchesFromFfTrimSources(store, store.sourceBatches);
}

export function formatRestoreSourcesSummary(plans: SourceRestorePlan[]): string {
  if (!plans.length) return "";
  return plans
    .map((plan) => {
      const grams = Math.round(plan.amountUsedLbs * GRAMS_PER_LB);
      return `${plan.sourceId}: ${grams.toLocaleString()} g`;
    })
    .join(" · ");
}
