/** Undo an A-grade dry-flower harvest and restore plants on the parent cultivation batch. */

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function hasPositiveWeightField(batch: any, keys: string[]): boolean {
  for (const key of keys) {
    const raw = batch?.[key];
    if (raw === undefined || raw === null || String(raw).trim() === "") continue;
    if (num(raw) > 0) return true;
  }
  return false;
}

function buckWholePlantLbs(batch: any): number {
  if (!batch) return 0;
  const w = num(batch.buckWholePlantLbs);
  if (w > 0) return w;
  return num(batch.buckedWeightLbs);
}

export function dryFlowerBatchHasPostHarvestWork(batch: any): boolean {
  if (!batch || typeof batch !== "object") return false;
  if (String(batch.status || "").trim() === "Complete") return true;

  const testStatus = String(batch.testStatus || "Not Submitted").trim();
  if (testStatus && testStatus !== "Not Submitted") return true;

  if (buckWholePlantLbs(batch) > 0) return true;
  if (hasPositiveWeightField(batch, [
    "buckStemWasteLbs",
    "trimmedWeightLbs",
    "popcornWeightLbs",
    "totalTrimLbs",
    "trimFromTrimmingLbs",
    "trimFromBuckLbs",
    "deconWeightLbs",
    "packagedWeightLbs",
    "packagedAGradeLbs",
    "packagedPopcornLbs",
    "remainingPackableLbs",
    "finalAGradeFlowerLbs",
    "finalPopcornLbs",
  ])) {
    return true;
  }

  const status = String(batch.status || "").trim();
  if (status && status !== "Drying / Curing") return true;

  return false;
}

export function getUndoDryFlowerHarvestBlockReason(batch: any): string | null {
  if (!batch?.id) return "Dry flower batch not found.";
  const sourceId = String(batch.source || "").trim();
  if (!sourceId) return "This dry batch has no linked cultivation source.";
  if (dryFlowerBatchHasPostHarvestWork(batch)) {
    return "Undo is only available before bucking, lab submission, or packaging. Delete the dry batch if you need to remove it after work has been logged.";
  }
  return null;
}

export function findCultivationBatchForDryFlower(
  store: { cultivationBatches?: unknown[]; completedCultivationBatches?: unknown[] },
  sourceId: string,
): { batch: any; fromCompleted: boolean } | null {
  const id = String(sourceId || "").trim();
  if (!id) return null;
  const active = (store.cultivationBatches || []).find((b: any) => b?.id === id);
  if (active) return { batch: active, fromCompleted: false };
  const completed = (store.completedCultivationBatches || []).find((b: any) => b?.id === id);
  if (completed) return { batch: completed, fromCompleted: true };
  return null;
}

export function inferCultivationStageAfterDryHarvestUndo(parent: any): string {
  const plants = num(parent?.plants);
  const dryH = num(parent?.plantsHarvestedDry);
  const ffH = num(parent?.plantsHarvestedFreshFrozen);
  if (plants <= 0 && dryH <= 0 && ffH <= 0) return "Harvested";
  if (plants > 0 && (dryH > 0 || ffH > 0)) return "Partially Harvested";
  if (parent?.flowerRoomId || parent?.flowerRoom) return "Flower";
  if (parent?.vegRoomId || parent?.vegRoom) return "Veg";
  return "Clone";
}

export type UndoDryFlowerHarvestResult =
  | {
      ok: true;
      dryBatchId: string;
      parentBatchId: string;
      plantsRestored: number;
      parentStage: string;
      reactivatedFromCompleted: boolean;
    }
  | { ok: false; message: string };

export function undoDryFlowerHarvestInStore(
  store: {
    dryFlowerBatches?: any[];
    productionBatches?: any[];
    cultivationBatches?: any[];
    completedCultivationBatches?: any[];
    logs?: any[];
  },
  dryBatchId: string,
): UndoDryFlowerHarvestResult {
  const id = String(dryBatchId || "").trim();
  if (!id) return { ok: false, message: "Dry flower batch not found." };

  const dryIdx = (store.dryFlowerBatches || []).findIndex((b: any) => b?.id === id);
  if (dryIdx < 0) return { ok: false, message: "Dry flower batch not found." };

  const dryBatch = store.dryFlowerBatches![dryIdx];
  const block = getUndoDryFlowerHarvestBlockReason(dryBatch);
  if (block) return { ok: false, message: block };

  const parentLookup = findCultivationBatchForDryFlower(store, String(dryBatch.source || ""));
  if (!parentLookup) {
    return {
      ok: false,
      message: `Parent cultivation batch "${dryBatch.source}" was not found. Refresh or restore the source batch first.`,
    };
  }

  const plantsRestored = Math.max(0, num(dryBatch.plantsHarvested));
  if (plantsRestored <= 0) {
    return {
      ok: false,
      message: "This dry batch has no recorded plant count to restore on the cultivation batch.",
    };
  }

  const parent = parentLookup.batch;
  const fromCompleted = parentLookup.fromCompleted;

  if (fromCompleted) {
    const list = store.completedCultivationBatches || [];
    const ci = list.findIndex((b: any) => b?.id === parent.id);
    if (ci >= 0) list.splice(ci, 1);
    if (!(store.cultivationBatches || []).some((b: any) => b?.id === parent.id)) {
      if (!store.cultivationBatches) store.cultivationBatches = [];
      store.cultivationBatches.unshift(parent);
    }
    delete parent.completedAt;
  }

  parent.plants = num(parent.plants) + plantsRestored;
  parent.plantsHarvestedDry = Math.max(0, num(parent.plantsHarvestedDry) - plantsRestored);
  parent.status = "Active";
  parent.stage = inferCultivationStageAfterDryHarvestUndo(parent);

  store.dryFlowerBatches!.splice(dryIdx, 1);
  store.productionBatches = (store.productionBatches || []).filter((b: any) => b?.id !== id);

  const logs = store.logs || [];
  store.logs = logs.filter((log: any) => {
    const batchKey = String(log?.batch || "").trim();
    const linked = String(log?.linkedBatch || "").trim();
    const source = String(log?.source || "").trim();
    if (batchKey === id || linked === id || source === id) return false;
    if (
      batchKey === parent.id &&
      linked === id &&
      String(log?.task || "").startsWith("Harvest -")
    ) {
      return false;
    }
    return true;
  });

  return {
    ok: true,
    dryBatchId: id,
    parentBatchId: String(parent.id),
    plantsRestored,
    parentStage: String(parent.stage),
    reactivatedFromCompleted: fromCompleted,
  };
}
