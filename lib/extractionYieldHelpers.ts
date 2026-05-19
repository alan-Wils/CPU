/** Shared yield math for extraction batches (terp separation + decarb + terp add-back). */

import { extractionBatchBiomassLbs } from "@/lib/extractionMergeHelpers";

export const EXTRACTION_GRAMS_PER_LB = 453.592;

export type ExtractionYieldMetrics = {
  biomassGrams: number;
  totalTerpsCollectedGrams: number;
  finalDecarbedOilGrams: number;
  terpAddBackPercent: number;
  terpsToAddBackGrams: number;
  actualTerpsAddedBackGrams: number;
  leftoverTerpsGrams: number;
  terpedOilGrams: number;
  oilYieldPercent: number;
  terpYieldPercent: number;
  totalBatchYieldPercent: number;
  terpedOilYieldPercent: number;
  leftoverTerpsPercent: number;
  terpAddBackCapped: boolean;
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function roundGrams(value: number): number {
  return +Math.max(0, value).toFixed(2);
}

export function roundYieldPercent(value: number): number {
  return +Math.max(0, value).toFixed(2);
}

export function extractionBatchBiomassGrams(batch: any): number {
  const lbs = extractionBatchBiomassLbs(batch);
  if (lbs <= 0) return 0;
  return roundGrams(lbs * EXTRACTION_GRAMS_PER_LB);
}

/** Terps collected at Finish Terp Separation (grams). */
export function readTotalTerpsCollectedGrams(batch: any): number {
  const direct = num(batch?.totalTerpsCollectedGrams);
  if (direct > 0) return direct;
  return num(batch?.taskData?.["Finish Terp Separation"]?.totalTerps);
}

/** Final decarbed oil after Finish Decarb (grams). */
export function readFinalDecarbedOilGrams(batch: any): number {
  const direct = num(batch?.finalDecarbedOilGrams);
  if (direct > 0) return direct;
  const fromTask = num(batch?.taskData?.["Finish Decarb"]?.finalDecarbedOilGrams);
  if (fromTask > 0) return fromTask;
  return num(batch?.taskData?.["Finish Decarb"]?.endWeight);
}

export function readTerpAddBackPercentFromConfig(extractionConfig: unknown): number {
  if (!extractionConfig || typeof extractionConfig !== "object") return 0;
  return Math.max(0, num((extractionConfig as Record<string, unknown>).terpAddBackPercentOfOilWeight));
}

export function computeExtractionYieldMetrics(
  batch: any,
  terpAddBackPercent = 0,
): ExtractionYieldMetrics | null {
  const biomassGrams = extractionBatchBiomassGrams(batch);
  if (biomassGrams <= 0) return null;

  const totalTerpsCollectedGrams = readTotalTerpsCollectedGrams(batch);
  const finalDecarbedOilGrams = readFinalDecarbedOilGrams(batch);
  const pct = (grams: number) =>
    biomassGrams > 0 ? roundYieldPercent((grams / biomassGrams) * 100) : 0;

  const addBackPct = Math.max(0, num(terpAddBackPercent));
  const terpsToAddBackGrams = roundGrams(finalDecarbedOilGrams * (addBackPct / 100));
  const actualTerpsAddedBackGrams = roundGrams(
    Math.min(terpsToAddBackGrams, totalTerpsCollectedGrams),
  );
  const leftoverTerpsGrams = roundGrams(
    Math.max(totalTerpsCollectedGrams - actualTerpsAddedBackGrams, 0),
  );
  const terpedOilGrams = roundGrams(finalDecarbedOilGrams + actualTerpsAddedBackGrams);
  const terpAddBackCapped =
    terpsToAddBackGrams > totalTerpsCollectedGrams && terpsToAddBackGrams > 0;

  return {
    biomassGrams,
    totalTerpsCollectedGrams: roundGrams(totalTerpsCollectedGrams),
    finalDecarbedOilGrams: roundGrams(finalDecarbedOilGrams),
    terpAddBackPercent: addBackPct,
    terpsToAddBackGrams,
    actualTerpsAddedBackGrams,
    leftoverTerpsGrams,
    terpedOilGrams,
    oilYieldPercent: pct(finalDecarbedOilGrams),
    terpYieldPercent: pct(totalTerpsCollectedGrams),
    totalBatchYieldPercent: pct(finalDecarbedOilGrams + totalTerpsCollectedGrams),
    terpedOilYieldPercent: pct(terpedOilGrams),
    leftoverTerpsPercent: pct(leftoverTerpsGrams),
    terpAddBackCapped,
  };
}

/** Persist computed yield fields on the batch root for API/dashboard reads. */
export function syncExtractionYieldFieldsToBatch(batch: any, terpAddBackPercent = 0): void {
  const metrics = computeExtractionYieldMetrics(batch, terpAddBackPercent);
  if (!metrics) return;

  batch.totalTerpsCollectedGrams = metrics.totalTerpsCollectedGrams;
  batch.finalDecarbedOilGrams = metrics.finalDecarbedOilGrams;
  batch.terpAddBackPercent = metrics.terpAddBackPercent;
  batch.terpsToAddBackGrams = metrics.terpsToAddBackGrams;
  batch.actualTerpsAddedBackGrams = metrics.actualTerpsAddedBackGrams;
  batch.leftoverTerpsGrams = metrics.leftoverTerpsGrams;
  batch.terpedOilGrams = metrics.terpedOilGrams;
  batch.oilYieldPercent = metrics.oilYieldPercent;
  batch.terpYieldPercent = metrics.terpYieldPercent;
  batch.totalBatchYieldPercent = metrics.totalBatchYieldPercent;
  batch.terpedOilYieldPercent = metrics.terpedOilYieldPercent;
  batch.leftoverTerpsPercent = metrics.leftoverTerpsPercent;
  batch.terpAddBackCapped = metrics.terpAddBackCapped;
}

export function hasExtractionDetailedYields(batch: any): boolean {
  const completed = Array.isArray(batch?.completedTasks) ? batch.completedTasks : [];
  return (
    completed.includes("Finish Terp Separation") && completed.includes("Finish Decarb")
  );
}

export function formatYieldPercentDisplay(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}%`;
}

export function formatYieldGramsDisplay(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(2)} g`;
}

/** Legacy Finish Batch yield: (oil + extra terps) / biomass. */
export function getLegacyFinishBatchYieldPercent(batch: any): string {
  const biomassLbs = extractionBatchBiomassLbs(batch);
  const oilGrams =
    num(batch?.finalOilGrams) || num(batch?.taskData?.["Finish Batch"]?.finalOilGrams);
  const terpsGrams =
    num(batch?.extraTerpsGrams) || num(batch?.taskData?.["Finish Batch"]?.extraTerpsGrams);
  const totalFinalGrams = oilGrams + terpsGrams;
  if (biomassLbs <= 0 || totalFinalGrams <= 0) return "";
  const biomassGrams = biomassLbs * EXTRACTION_GRAMS_PER_LB;
  return formatYieldPercentDisplay((totalFinalGrams / biomassGrams) * 100);
}

export function buildFinishDecarbYieldTaskFields(
  batch: any,
  finalDecarbedOilGrams: number,
  terpAddBackPercent: number,
): Record<string, unknown> {
  const previewBatch = {
    ...batch,
    finalDecarbedOilGrams,
    totalTerpsCollectedGrams: readTotalTerpsCollectedGrams(batch),
  };
  const metrics = computeExtractionYieldMetrics(previewBatch, terpAddBackPercent);
  if (!metrics) {
    return {
      finalDecarbedOilGrams: roundGrams(finalDecarbedOilGrams),
      terpAddBackPercent: Math.max(0, num(terpAddBackPercent)),
    };
  }
  return {
    finalDecarbedOilGrams: metrics.finalDecarbedOilGrams,
    terpAddBackPercent: metrics.terpAddBackPercent,
    terpsToAddBackGrams: metrics.terpsToAddBackGrams,
    actualTerpsAddedBackGrams: metrics.actualTerpsAddedBackGrams,
    leftoverTerpsGrams: metrics.leftoverTerpsGrams,
    terpedOilGrams: metrics.terpedOilGrams,
    terpAddBackCapped: metrics.terpAddBackCapped,
  };
}
