/** Helpers for combining / uncombining extraction runs in the Extraction UI. */

import {
  hasCompletedExtractionTask,
  type ExtractionUiStageKey,
} from "@/lib/extractionBatchUiStage";

export type ExtractionCombineWeightUnit = "lbs" | "grams";

export type ExtractionCombineMergeLogData = {
  combineBatches?: boolean;
  survivorBatchId?: string;
  absorbedBatchId?: string;
  biomassBeforePartner?: number | string | null;
  biomassBeforeSurvivor?: number | string | null;
  biomassAfterCombine?: number | string | null;
  oilBeforePartner?: number | string | null;
  oilBeforeSurvivor?: number | string | null;
  oilAfterCombine?: number | string | null;
  combineWeightUnit?: ExtractionCombineWeightUnit;
  uiStageBucket?: string;
  notes?: string;
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function findExtractionCombineMergeDataForPair(
  logs: any[],
  survivorBatchId: string,
  absorbedBatchId: string,
): ExtractionCombineMergeLogData | null {
  for (const log of logs || []) {
    if (String(log?.task) !== "Combine Batches") continue;
    const d = log?.data as ExtractionCombineMergeLogData | undefined;
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

/** Partner row absorbed into another extraction batch (still returned by GET /api/extraction until uncombined). */
export function isExtractionBatchMergedAbsorbed(batch: any): boolean {
  if (!batch?.id) return false;
  if (String(batch.mergedIntoBatchId || "").trim()) return true;
  return String(batch.status || "").toLowerCase().includes("merged");
}

export type MergedExtractionPartnerLocation = {
  batch: any;
  storage: "active" | "completed";
  index: number;
};

/** Find absorbed partner in active or completed lists (API reload keeps merged rows in active). */
export function findMergedExtractionPartnerBatch(
  partnerId: string,
  survivorId: string,
  activeBatches: any[],
  completedBatches: any[],
): MergedExtractionPartnerLocation | null {
  const pid = String(partnerId || "").trim();
  const sid = String(survivorId || "").trim();
  if (!pid || !sid) return null;

  const matchSurvivor = (batch: any) => String(batch?.mergedIntoBatchId || "").trim() === sid;

  let index = (completedBatches || []).findIndex((b: any) => b?.id === pid);
  if (index >= 0) {
    const batch = completedBatches[index];
    if (matchSurvivor(batch)) return { batch, storage: "completed", index };
  }

  index = (activeBatches || []).findIndex((b: any) => b?.id === pid);
  if (index >= 0) {
    const batch = activeBatches[index];
    if (matchSurvivor(batch)) return { batch, storage: "active", index };
  }

  return null;
}

export function isExtractionBatchActiveForCombine(batch: any): boolean {
  if (!batch?.id) return false;
  if (isExtractionBatchMergedAbsorbed(batch)) return false;
  const st = String(batch.status || "").toLowerCase();
  if (st.includes("merged")) return false;
  if (st.includes("finished") || st.includes("sent to packaging")) return false;
  const completed = Array.isArray(batch.completedTasks) ? batch.completedTasks : [];
  if (completed.includes("Finish Batch")) return false;
  return true;
}

export function extractionSourcesAreCompatible(sources: any[]): boolean {
  const materialTypes = new Set<string>();
  for (const row of sources || []) {
    const mt = String(row?.materialType || row?.sourceMaterialType || "").toLowerCase();
    if (mt.includes("dry") || mt.includes("trim") || mt === "drytrim") {
      materialTypes.add("dryTrim");
    } else if (mt.includes("fresh") || mt.includes("frozen") || mt === "freshfrozen") {
      materialTypes.add("freshFrozen");
    }
  }
  return !(materialTypes.has("dryTrim") && materialTypes.has("freshFrozen"));
}

export function mergeExtractionSourceRows(survivor: any[], partner: any[]): any[] {
  const map = new Map<string, any>();
  for (const row of [...(survivor || []), ...(partner || [])]) {
    const sourceId = String(row?.sourceId || row?.id || "").trim();
    if (!sourceId) continue;
    const amountUsed = num(row?.amountUsed ?? row?.amount);
    const prev = map.get(sourceId);
    if (prev) {
      prev.amountUsed = +(num(prev.amountUsed) + amountUsed).toFixed(2);
    } else {
      map.set(sourceId, { ...row, sourceId, amountUsed });
    }
  }
  return Array.from(map.values());
}

export function subtractExtractionSourceRows(survivor: any[], partner: any[]): any[] {
  const map = new Map<string, any>();
  for (const row of survivor || []) {
    const sourceId = String(row?.sourceId || row?.id || "").trim();
    if (!sourceId) continue;
    map.set(sourceId, { ...row, sourceId, amountUsed: num(row?.amountUsed ?? row?.amount) });
  }
  for (const row of partner || []) {
    const sourceId = String(row?.sourceId || row?.id || "").trim();
    if (!sourceId) continue;
    const prev = map.get(sourceId);
    if (!prev) continue;
    const next = num(prev.amountUsed) - num(row?.amountUsed ?? row?.amount);
    if (next <= 0.0001) {
      map.delete(sourceId);
    } else {
      prev.amountUsed = +next.toFixed(2);
    }
  }
  return Array.from(map.values());
}

/** After Run Extraction, combine prompts for extracted oil (g) instead of biomass (lbs). */
export function extractionCombineUsesOilGrams(batch: any): boolean {
  return hasCompletedExtractionTask(batch, "Run Extraction");
}

/** Read extracted oil weight in grams (final oil only, not extra terps). */
export function extractionBatchOilGrams(batch: any): number {
  const direct = num(batch?.finalOilGrams);
  if (direct > 0) return direct;
  const fromFinish = num(batch?.taskData?.["Finish Batch"]?.finalOilGrams);
  if (fromFinish > 0) return fromFinish;
  const total = num(batch?.totalFinalGrams);
  const terps =
    num(batch?.extraTerpsGrams) || num(batch?.taskData?.["Finish Batch"]?.extraTerpsGrams);
  if (total > 0) return +Math.max(0, total - terps).toFixed(2);
  return 0;
}

/** Set combined extracted oil on survivor; keeps any logged extra terps in totalFinalGrams. */
export function setExtractionBatchCombinedOilGrams(batch: any, oilGrams: number) {
  const oil = +Math.max(0, oilGrams).toFixed(2);
  batch.finalOilGrams = oil;
  const terps =
    num(batch?.extraTerpsGrams) || num(batch?.taskData?.["Finish Batch"]?.extraTerpsGrams);
  batch.totalFinalGrams = +(oil + terps).toFixed(2);
}

/** Read total biomass in lbs from batch fields. */
export function extractionBatchBiomassLbs(batch: any): number {
  const direct = num(batch?.totalBiomassUsed);
  if (direct > 0) return direct;
  const amt = String(batch?.amount ?? "");
  const match = amt.match(/([\d.]+)/);
  return match ? num(match[1]) : 0;
}

/** Set total biomass on a batch (lbs string + inputGrams estimate). */
export function setExtractionBatchTotalBiomassLbs(batch: any, totalLbs: number) {
  const lbs = +Math.max(0, totalLbs).toFixed(2);
  batch.totalBiomassUsed = lbs;
  batch.amount = `${lbs} lbs`;
  batch.inputGrams = +(lbs * 453.592).toFixed(2);
}

export function rebuildExtractionBatchSourceSummary(batch: any, sources: any[]) {
  const rows = Array.isArray(sources) ? sources : [];
  const totalBiomassUsed = +rows
    .reduce((sum, row) => sum + num(row?.amountUsed ?? row?.amount), 0)
    .toFixed(2);
  batch.sources = rows;
  batch.totalBiomassUsed = totalBiomassUsed;
  batch.amount = `${totalBiomassUsed} lbs`;
  batch.source = rows
    .map((row) => String(row?.sourceId || "").trim())
    .filter(Boolean)
    .join(", ");
  const blendNames = [
    ...new Set(rows.map((row) => String(row?.name || "").trim()).filter(Boolean)),
  ];
  if (blendNames.length > 0) {
    batch.sourceBlendLabel = blendNames.join(" · ");
  }
  batch.inputGrams = +(num(batch.inputGrams) > 0 ? num(batch.inputGrams) : totalBiomassUsed * 453.592).toFixed(
    2,
  );
}

export function resolveAbsorbedForUncombine(
  partner: any,
  logs: any[],
  survivorId: string,
  partnerId: string,
): {
  biomassLbs: number;
  oilGrams?: number;
  combineWeightUnit: ExtractionCombineWeightUnit;
  sources: any[];
  statusBeforeMerge: string;
  uiStageBeforeMerge: ExtractionUiStageKey;
} | null {
  const snap = partner?.mergedIntoSnapshot;
  const logMatch = findExtractionCombineMergeDataForPair(logs, survivorId, partnerId);
  const combineWeightUnit: ExtractionCombineWeightUnit =
    snap?.combineWeightUnit === "grams" || logMatch?.combineWeightUnit === "grams"
      ? "grams"
      : "lbs";

  let biomass: number | undefined;
  if (snap != null && snap.biomassAbsorbed !== undefined && snap.biomassAbsorbed !== "") {
    const n = Number(snap.biomassAbsorbed);
    if (Number.isFinite(n)) biomass = n;
  }
  if (biomass === undefined && logMatch != null) {
    const raw = logMatch.biomassBeforePartner;
    if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
      const n = Number(raw);
      if (Number.isFinite(n)) biomass = n;
    }
  }
  if (biomass === undefined && combineWeightUnit === "lbs") return null;

  let oilGrams: number | undefined;
  if (combineWeightUnit === "grams") {
    if (snap != null && snap.oilAbsorbed !== undefined && snap.oilAbsorbed !== "") {
      const n = Number(snap.oilAbsorbed);
      if (Number.isFinite(n)) oilGrams = n;
    }
    if (oilGrams === undefined && logMatch != null) {
      const raw = logMatch.oilBeforePartner;
      if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
        const n = Number(raw);
        if (Number.isFinite(n)) oilGrams = n;
      }
    }
    if (oilGrams === undefined) return null;
  }

  const sources = Array.isArray(snap?.sourcesSnapshot)
    ? snap.sourcesSnapshot.map((r: any) => ({ ...r }))
    : [];
  const statusBeforeMerge = String(snap?.statusBeforeMerge || "Ready For Pack Socks Start").trim();
  const uiStageBeforeMerge = String(snap?.uiStageBeforeMerge || logMatch?.uiStageBucket || "prep").trim() as ExtractionUiStageKey;
  return {
    biomassLbs: Math.max(0, biomass ?? 0),
    oilGrams: oilGrams !== undefined ? Math.max(0, oilGrams) : undefined,
    combineWeightUnit,
    sources,
    statusBeforeMerge: statusBeforeMerge || "Ready For Pack Socks Start",
    uiStageBeforeMerge:
      uiStageBeforeMerge === "extraction" ||
      uiStageBeforeMerge === "post" ||
      uiStageBeforeMerge === "testing"
        ? uiStageBeforeMerge
        : "prep",
  };
}

