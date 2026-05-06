/** Parse Combine Batches audit payload for cultivation UI (survivor restores). */

export type CombineMergeLogData = {
  combineBatches?: boolean;
  survivorBatchId?: string;
  absorbedBatchId?: string;
  /** Persisted logs may coerce counts to strings depending on serialization. */
  plantsBeforePartner?: number | string | null;
  plantsBeforeSurvivor?: number;
  plantsAfterCombine?: number;
  stageBucket?: string;
};

export function findCombineMergeDataForPair(
  logs: any[],
  survivorBatchId: string,
  absorbedBatchId: string,
): CombineMergeLogData | null {
  for (const log of logs || []) {
    if (String(log?.task) !== "Combine Batches") continue;
    const d = log?.data as CombineMergeLogData | undefined;
    if (!d?.combineBatches) continue;
    if (
      String(d.survivorBatchId) === survivorBatchId &&
      String(d.absorbedBatchId) === absorbedBatchId
    ) {
      return d;
    }
  }
  return null;
}

export function cultivationStageFromCombineBucket(bucket: unknown): string {
  const b = String(bucket || "").trim();
  if (b === "Clones") return "Clone";
  if (b === "Veg") return "Veg";
  if (b === "Flower") return "Flower";
  return "Clone";
}

/** Resolve absorbed plant total and restored stage when undoing a combine (snapshot + fallback log). */
export function resolveAbsorbedPlantsAndStageForUncombine(
  partner: any,
  logs: any[],
  survivorId: string,
  partnerId: string,
): { plants: number; stage: string } | null {
  const snap = partner?.mergedIntoSnapshot;
  let plants: number | undefined;
  if (snap != null && snap.plantsAbsorbed !== undefined && snap.plantsAbsorbed !== "") {
    const n = Number(snap.plantsAbsorbed);
    if (Number.isFinite(n)) plants = n;
  }
  const logMatch = findCombineMergeDataForPair(logs, survivorId, partnerId);
  let stage = String(snap?.stageBeforeMerge ?? "").trim();
  if (!stage && logMatch?.stageBucket != null && String(logMatch.stageBucket).trim() !== "") {
    stage = cultivationStageFromCombineBucket(logMatch.stageBucket);
  }

  if (plants === undefined && logMatch != null) {
    const raw = logMatch.plantsBeforePartner;
    if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
      const n = Number(raw);
      if (Number.isFinite(n)) plants = n;
    }
  }

  if (plants === undefined) return null;
  const stageOut = stage || cultivationStageFromCombineBucket(logMatch?.stageBucket);
  return { plants: Math.max(0, plants), stage: stageOut };
}
