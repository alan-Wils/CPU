/** Helpers for combining / uncombining extraction runs in the Extraction UI. */

import type { ExtractionUiStageKey } from "@/lib/extractionBatchUiStage";

export type ExtractionCombineMergeLogData = {
  combineBatches?: boolean;
  survivorBatchId?: string;
  absorbedBatchId?: string;
  biomassBeforePartner?: number | string | null;
  biomassBeforeSurvivor?: number | string | null;
  biomassAfterCombine?: number | string | null;
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

export function isExtractionBatchActiveForCombine(batch: any): boolean {
  if (!batch?.id) return false;
  if (String(batch.mergedIntoBatchId || "").trim()) return false;
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

export function resolveAbsorbedBiomassForUncombine(
  partner: any,
  logs: any[],
  survivorId: string,
  partnerId: string,
): { biomassLbs: number; sources: any[]; statusBeforeMerge: string; uiStageBeforeMerge: ExtractionUiStageKey } | null {
  const snap = partner?.mergedIntoSnapshot;
  let biomass: number | undefined;
  if (snap != null && snap.biomassAbsorbed !== undefined && snap.biomassAbsorbed !== "") {
    const n = Number(snap.biomassAbsorbed);
    if (Number.isFinite(n)) biomass = n;
  }
  const logMatch = findExtractionCombineMergeDataForPair(logs, survivorId, partnerId);
  if (biomass === undefined && logMatch != null) {
    const raw = logMatch.biomassBeforePartner;
    if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
      const n = Number(raw);
      if (Number.isFinite(n)) biomass = n;
    }
  }
  if (biomass === undefined) return null;

  const sources = Array.isArray(snap?.sourcesSnapshot)
    ? snap.sourcesSnapshot.map((r: any) => ({ ...r }))
    : [];
  const statusBeforeMerge = String(snap?.statusBeforeMerge || "Ready For Pack Socks Start").trim();
  const uiStageBeforeMerge = String(snap?.uiStageBeforeMerge || logMatch?.uiStageBucket || "prep").trim() as ExtractionUiStageKey;
  return {
    biomassLbs: Math.max(0, biomass),
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
