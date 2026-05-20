/** Helpers for combining / uncombining extraction runs in the Extraction UI. */

import {
  hasCompletedExtractionTask,
  type ExtractionUiStageKey,
} from "@/lib/extractionBatchUiStage";

export type ExtractionCombineWeightUnit = "lbs" | "grams";

type ExtractionSourceRowLike = {
  sourceId?: unknown;
  id?: unknown;
  amountUsed?: unknown;
  amount?: unknown;
  name?: unknown;
  materialType?: unknown;
  acronym?: unknown;
};

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
  const id = String(batch.id).trim();
  const mergedInto = String(batch.mergedIntoBatchId || "").trim();
  if (mergedInto && mergedInto === id) return false;
  const status = String(batch.status || "").toLowerCase();
  if (mergedInto && !status.includes("merged")) return false;
  if (mergedInto) return true;
  return status.includes("merged");
}

/**
 * Clears stale merge markers when a batch is still in active workflow (e.g. after editing market code
 * rehydrated a ghost `mergedIntoBatchId` from company-store snapshot).
 */
export function sanitizeExtractionBatchMergeState(batch: any): any {
  if (!batch || typeof batch !== "object") return batch;
  const id = String(batch.id || "").trim();
  if (!id) return batch;
  const mergedInto = String(batch.mergedIntoBatchId || "").trim();
  const status = String(batch.status || "").toLowerCase();
  if (!mergedInto) return batch;
  if (mergedInto === id || !status.includes("merged")) {
    const out = { ...batch };
    delete out.mergedIntoBatchId;
    delete out.mergedIntoSnapshot;
    delete out.completedAt;
    return out;
  }
  return batch;
}

/** PUT body for editing name / product / market code on a non-merged active batch. */
export function extractionBatchPutPayloadForDetailEdit(batch: any): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...batch };
  if ("_db" in payload) delete payload._db;
  if (isExtractionBatchMergedAbsorbed(batch)) return payload;
  payload.mergedIntoBatchId = null;
  payload.mergedIntoSnapshot = null;
  payload.completedAt = null;
  return payload;
}

/** Active extraction list should not show merged partners. */
export function filterActiveExtractionBatches(batches: any[]): any[] {
  return (batches || []).filter((b) => !isExtractionBatchMergedAbsorbed(b));
}

/**
 * Move merged partners from active \u2192 completed (API poll can briefly return them as active).
 */
export function sweepMergedExtractionBatchesToCompleted(store: {
  extractionBatches?: any[];
  completedExtractionBatches?: any[];
}): void {
  const active = Array.isArray(store.extractionBatches) ? store.extractionBatches : [];
  if (!Array.isArray(store.completedExtractionBatches)) {
    store.completedExtractionBatches = [];
  }
  const completedById = new Map<string, any>();
  for (const row of store.completedExtractionBatches) {
    const id = String(row?.id || "");
    if (id) completedById.set(id, row);
  }
  const stillActive: any[] = [];
  for (const row of active) {
    if (isExtractionBatchMergedAbsorbed(row)) {
      const id = String(row.id);
      completedById.set(id, row);
    } else {
      stillActive.push(row);
    }
  }
  store.extractionBatches = stillActive;
  store.completedExtractionBatches = Array.from(completedById.values());
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

/** Biomass weighed at Pack Socks Stop (when totalBiomassUsed was never saved). */
export function extractionBatchPreparedBiomassLbs(batch: any): number {
  const stop = batch?.taskData?.["Pack Socks Stop"];
  if (!stop || typeof stop !== "object") return 0;
  const lbs = num((stop as { totalPreparedLbs?: unknown }).totalPreparedLbs);
  if (lbs > 0) return lbs;
  const grams = num((stop as { totalPreparedGrams?: unknown }).totalPreparedGrams);
  if (grams > 0) return +(grams / 453.592).toFixed(4);
  return 0;
}

function extractionBatchBiomassFromSourceRows(batch: any): number {
  const rows: ExtractionSourceRowLike[] = Array.isArray(batch?.sources)
    ? (batch.sources as ExtractionSourceRowLike[])
    : [];
  if (rows.length === 0) return 0;
  return +rows
    .reduce((sum: number, row: ExtractionSourceRowLike) => {
      return sum + num(row?.amountUsed ?? row?.amount);
    }, 0)
    .toFixed(2);
}

/** Read total biomass in lbs from batch fields (sources, pack socks, or amount string). */
export function extractionBatchBiomassLbs(batch: any): number {
  const direct = num(batch?.totalBiomassUsed);
  if (direct > 0) return direct;
  const amt = String(batch?.amount ?? "");
  const match = amt.match(/([\d.]+)/);
  if (match && num(match[1]) > 0) return num(match[1]);
  const fromSources = extractionBatchBiomassFromSourceRows(batch);
  if (fromSources > 0) return fromSources;
  return extractionBatchPreparedBiomassLbs(batch);
}

/** Source rows for UI when legacy batches only stored comma-separated `source` ids. */
export function resolveExtractionBatchSourceRows(
  batch: any,
  getSource?: (sourceId: string) => any | null | undefined,
): any[] {
  const existing: ExtractionSourceRowLike[] = Array.isArray(batch?.sources)
    ? (batch.sources as ExtractionSourceRowLike[])
    : [];
  const normalized = existing
    .map((row: ExtractionSourceRowLike) => {
      const sourceId = String(row?.sourceId ?? row?.id ?? "").trim();
      if (!sourceId) return null;
      return { ...row, sourceId };
    })
    .filter((row): row is ExtractionSourceRowLike & { sourceId: string } => row != null);
  if (normalized.length > 0) return normalized;

  const ids = String(batch?.source || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) return [];

  const totalLbs = extractionBatchBiomassLbs(batch);
  const each = ids.length > 0 ? +(totalLbs / ids.length).toFixed(4) : 0;
  return ids.map((sourceId) => {
    const src = getSource?.(sourceId);
    const type = String(src?.type ?? "").toLowerCase();
    const materialType =
      type.includes("dry") || type.includes("trim")
        ? "dryTrim"
        : type.includes("fresh") || type.includes("frozen")
          ? "freshFrozen"
          : undefined;
    return {
      sourceId,
      name: String(src?.name ?? src?.type ?? batch?.sourceBlendLabel ?? sourceId).trim(),
      amountUsed: each,
      ...(materialType ? { materialType } : {}),
      ...(src?.acronym ? { acronym: src.acronym } : {}),
    };
  });
}

/** Backfill missing biomass / source summary before persisting or after combine. */
export function ensureExtractionBatchMaterialTotals(
  batch: any,
  getSource?: (sourceId: string) => any | null | undefined,
): void {
  const rows = resolveExtractionBatchSourceRows(batch, getSource);
  if (rows.length > 0) {
    rebuildExtractionBatchSourceSummary(batch, rows);
  }
  if (extractionBatchBiomassLbs(batch) <= 0) {
    const prep = extractionBatchPreparedBiomassLbs(batch);
    if (prep > 0) setExtractionBatchTotalBiomassLbs(batch, prep);
  }
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
    batch.sourceBlendLabel = blendNames.join(" \u00b7 ");
  }
  batch.inputGrams = +(num(batch.inputGrams) > 0 ? num(batch.inputGrams) : totalBiomassUsed * 453.592).toFixed(
    2,
  );
}

const EXTRACTION_PRE_MERGE_UI_KEYS = [
  "totalBiomassUsed",
  "amount",
  "inputGrams",
  "finalOilGrams",
  "totalFinalGrams",
  "extraTerpsGrams",
  "finalDecarbedOilGrams",
  "totalTerpsCollectedGrams",
  "oilYieldPercent",
  "terpYieldPercent",
  "totalBatchYieldPercent",
  "terpedOilGrams",
  "terpedOilYieldPercent",
  "leftoverTerpsGrams",
] as const;

/** Capture partner totals before merge so uncombine can restore card metrics. */
export function captureExtractionPreMergeUiSnapshot(batch: any): Record<string, unknown> {
  const snap: Record<string, unknown> = {};
  for (const key of EXTRACTION_PRE_MERGE_UI_KEYS) {
    if (batch?.[key] !== undefined && batch[key] !== null && batch[key] !== "") {
      snap[key] = batch[key];
    }
  }
  if (Array.isArray(batch?.sources) && batch.sources.length > 0) {
    snap.sources = batch.sources.map((r: any) => ({ ...r }));
  }
  if (Array.isArray(batch?.completedTasks) && batch.completedTasks.length > 0) {
    snap.completedTasks = batch.completedTasks.map(String);
  }
  if (
    batch?.taskData &&
    typeof batch.taskData === "object" &&
    !Array.isArray(batch.taskData)
  ) {
    snap.taskData = JSON.parse(JSON.stringify(batch.taskData));
  }
  return snap;
}

export function applyExtractionPreMergeUiSnapshot(
  batch: any,
  preMerge: Record<string, unknown> | null | undefined,
): boolean {
  if (!preMerge || typeof preMerge !== "object") return false;
  let applied = false;
  for (const key of EXTRACTION_PRE_MERGE_UI_KEYS) {
    if (preMerge[key] !== undefined && preMerge[key] !== null && preMerge[key] !== "") {
      batch[key] = preMerge[key];
      applied = true;
    }
  }
  if (Array.isArray(preMerge.sources) && preMerge.sources.length > 0) {
    batch.sources = (preMerge.sources as any[]).map((r) => ({ ...r }));
    applied = true;
  }
  if (Array.isArray(preMerge.completedTasks) && preMerge.completedTasks.length > 0) {
    batch.completedTasks = [...(preMerge.completedTasks as string[])];
    applied = true;
  }
  if (
    preMerge.taskData &&
    typeof preMerge.taskData === "object" &&
    !Array.isArray(preMerge.taskData)
  ) {
    batch.taskData = JSON.parse(JSON.stringify(preMerge.taskData));
    applied = true;
  }
  return applied;
}

export type ExtractionAbsorbedForUncombine = {
  biomassLbs: number;
  oilGrams?: number;
  combineWeightUnit: ExtractionCombineWeightUnit;
  sources: any[];
  statusBeforeMerge: string;
  uiStageBeforeMerge: ExtractionUiStageKey;
};

/** Restore partner biomass/oil/yield after uncombine (snapshot first, then merge log fields). */
export function applyExtractionPartnerUncombineRestore(
  partner: any,
  resolved: ExtractionAbsorbedForUncombine,
): void {
  const preMerge = partner?.mergedIntoSnapshot?.preMergeUiSnapshot;
  const restoredFromPreMerge = applyExtractionPreMergeUiSnapshot(partner, preMerge);

  if (Array.isArray(resolved.sources) && resolved.sources.length > 0) {
    partner.sources = resolved.sources.map((r: any) => ({ ...r }));
    rebuildExtractionBatchSourceSummary(partner, partner.sources);
  } else if (!restoredFromPreMerge && resolved.biomassLbs > 0) {
    setExtractionBatchTotalBiomassLbs(partner, resolved.biomassLbs);
  }

  if (resolved.combineWeightUnit === "grams" && (resolved.oilGrams ?? 0) > 0) {
    const currentOil = extractionBatchOilGrams(partner);
    if (currentOil <= 0) {
      setExtractionBatchCombinedOilGrams(partner, resolved.oilGrams ?? 0);
    }
  } else if (
    resolved.combineWeightUnit === "lbs" &&
    resolved.biomassLbs > 0 &&
    extractionBatchBiomassLbs(partner) <= 0
  ) {
    setExtractionBatchTotalBiomassLbs(partner, resolved.biomassLbs);
  }
}

function extractionPollFinalGrams(batch: any): number {
  const total = num(batch?.totalFinalGrams);
  if (total > 0) return total;
  const oil = extractionBatchOilGrams(batch);
  const terps = num(batch?.extraTerpsGrams);
  return +(oil + terps).toFixed(2);
}

export function resolveAbsorbedForUncombine(
  partner: any,
  logs: any[],
  survivorId: string,
  partnerId: string,
): ExtractionAbsorbedForUncombine | null {
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

export function getExtractionCombinedPartnerIds(batch: any): string[] {
  if (!batch || !Array.isArray(batch.combinedFromBatchIds)) return [];
  return batch.combinedFromBatchIds
    .map((id: unknown) => String(id || "").trim())
    .filter(Boolean);
}

/** Partner was absorbed via Combine Batches (not a stale `combinedFromBatchIds` pointer). */
export function isPartnerMergedIntoSurvivor(partner: any, survivorId: string): boolean {
  const pid = String(partner?.id || "").trim();
  const sid = String(survivorId || "").trim();
  if (!pid || !sid || pid === sid) return false;
  const mergedInto = String(partner?.mergedIntoBatchId || "").trim();
  if (mergedInto !== sid) return false;
  return String(partner?.status || "")
    .toLowerCase()
    .includes("merged");
}

function indexExtractionBatchById(batches: any[]): Map<string, any> {
  const byId = new Map<string, any>();
  for (const row of batches || []) {
    const id = String(row?.id || "").trim();
    if (id) byId.set(id, row);
  }
  return byId;
}

/**
 * `combinedFromBatchIds` entries that still point at a batch truly merged into this survivor.
 * Drops phantom links when the partner is still an active separate batch.
 */
export function getValidatedCombinedPartnerIds(
  survivor: any,
  activeBatches: any[],
  completedBatches: any[],
): string[] {
  const sid = String(survivor?.id || "").trim();
  const listed = getExtractionCombinedPartnerIds(survivor);
  if (!sid || listed.length === 0) return [];

  const byId = indexExtractionBatchById([
    ...(activeBatches || []),
    ...(completedBatches || []),
  ]);

  return listed.filter((pid) => {
    const partner = byId.get(pid);
    if (!partner) return false;
    return isPartnerMergedIntoSurvivor(partner, sid);
  });
}

/** Mutates survivor when stored merge list includes phantom partner ids. Returns whether it changed. */
export function applyPrunedCombinedFromBatchIds(
  survivor: any,
  activeBatches: any[],
  completedBatches: any[],
): boolean {
  if (!survivor?.id) return false;
  const pruned = getValidatedCombinedPartnerIds(survivor, activeBatches, completedBatches);
  const current = getExtractionCombinedPartnerIds(survivor);
  if (
    pruned.length === current.length &&
    pruned.every((id, index) => id === current[index])
  ) {
    return false;
  }
  if (pruned.length === 0) {
    delete survivor.combinedFromBatchIds;
  } else {
    survivor.combinedFromBatchIds = pruned;
  }
  return true;
}

export function sweepPhantomCombinedLinksOnBatches(
  activeBatches: any[],
  completedBatches: any[],
): boolean {
  let changed = false;
  for (const row of activeBatches || []) {
    if (applyPrunedCombinedFromBatchIds(row, activeBatches, completedBatches)) {
      changed = true;
    }
  }
  return changed;
}

export function survivorPutPayloadAfterPhantomMergeClear(survivor: any): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...survivor };
  const ids = getExtractionCombinedPartnerIds(survivor);
  if (ids.length === 0) {
    payload.combinedFromBatchIds = null;
  }
  return payload;
}

/** PUT body: JSON omits `undefined`, so send `null` to clear merge fields in extractionUiState. */
export function extractionBatchPutPayloadAfterUncombinePartner(
  batch: any,
): Record<string, unknown> {
  return {
    ...batch,
    mergedIntoBatchId: null,
    mergedIntoSnapshot: null,
    completedAt: null,
  };
}

/** PUT body: clear survivor merge list when the last partner was restored. */
export function extractionBatchPutPayloadAfterUncombineSurvivor(
  batch: any,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...batch };
  if (getExtractionCombinedPartnerIds(batch).length === 0) {
    payload.combinedFromBatchIds = null;
  }
  return payload;
}

const EXTRACTION_POLL_WEIGHT_FIELDS = [
  "status",
  "sources",
  "totalBiomassUsed",
  "amount",
  "inputGrams",
  "finalOilGrams",
  "totalFinalGrams",
  "source",
  "sourceBlendLabel",
  "extraTerpsGrams",
  "finalDecarbedOilGrams",
  "totalTerpsCollectedGrams",
  "oilYieldPercent",
  "totalBatchYieldPercent",
  "terpedOilGrams",
] as const;

function extractionPollTaskNodeIsEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

function pickExtractionPollWeightFields(localBatch: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of EXTRACTION_POLL_WEIGHT_FIELDS) {
    if (localBatch[key] !== undefined) out[key] = localBatch[key];
  }
  return out;
}

/**
 * When polling, keep optimistic task progress and local uncombine state if the server row is stale.
 */
export function mergeExtractionPollState(serverBatch: any, localBatch: any): any {
  if (!localBatch || !serverBatch || String(serverBatch.id) !== String(localBatch.id)) {
    return serverBatch || localBatch;
  }
  const ctS = Array.isArray(serverBatch.completedTasks)
    ? serverBatch.completedTasks.map(String)
    : [];
  const ctL = Array.isArray(localBatch.completedTasks)
    ? localBatch.completedTasks.map(String)
    : [];
  const completedTasks = [...ctS, ...ctL.filter((t: string) => !ctS.includes(t))];

  const tdS =
    serverBatch.taskData &&
    typeof serverBatch.taskData === "object" &&
    !Array.isArray(serverBatch.taskData)
      ? serverBatch.taskData
      : {};
  const tdL =
    localBatch.taskData &&
    typeof localBatch.taskData === "object" &&
    !Array.isArray(localBatch.taskData)
      ? localBatch.taskData
      : {};
  const keys = new Set([...Object.keys(tdS), ...Object.keys(tdL)]);
  const taskData: Record<string, unknown> = {};
  for (const k of keys) {
    const b = tdS[k];
    const a = tdL[k];
    if (extractionPollTaskNodeIsEmpty(b) && !extractionPollTaskNodeIsEmpty(a)) {
      taskData[k] = a;
    } else if (extractionPollTaskNodeIsEmpty(a) && !extractionPollTaskNodeIsEmpty(b)) {
      taskData[k] = b;
    } else if (
      typeof a === "object" &&
      typeof b === "object" &&
      a &&
      b &&
      !Array.isArray(a) &&
      !Array.isArray(b)
    ) {
      taskData[k] = { ...(b as Record<string, unknown>), ...(a as Record<string, unknown>) };
    } else {
      taskData[k] = !extractionPollTaskNodeIsEmpty(b) ? b : a;
    }
  }

  let merged: any = {
    ...serverBatch,
    completedTasks: completedTasks.length ? completedTasks : serverBatch.completedTasks,
    taskData,
  };

  const localAbsorbed = isExtractionBatchMergedAbsorbed(localBatch);
  const serverAbsorbed = isExtractionBatchMergedAbsorbed(serverBatch);
  if (!localAbsorbed && serverAbsorbed) {
    merged = {
      ...merged,
      ...pickExtractionPollWeightFields(localBatch),
    };
    delete merged.mergedIntoBatchId;
    delete merged.mergedIntoSnapshot;
    delete merged.completedAt;
  } else if (localAbsorbed && !serverAbsorbed) {
    delete merged.mergedIntoBatchId;
    delete merged.mergedIntoSnapshot;
    delete merged.completedAt;
  }

  const localCombined = getExtractionCombinedPartnerIds(localBatch);
  const serverCombined = getExtractionCombinedPartnerIds(serverBatch);
  if (localCombined.length < serverCombined.length) {
    merged = {
      ...merged,
      ...pickExtractionPollWeightFields(localBatch),
    };
    if (localCombined.length === 0) {
      delete merged.combinedFromBatchIds;
    } else {
      merged.combinedFromBatchIds = [...localCombined];
    }
  }

  const localBio = extractionBatchBiomassLbs(localBatch);
  const serverBio = extractionBatchBiomassLbs(merged);
  const localFinal = extractionPollFinalGrams(localBatch);
  const serverFinal = extractionPollFinalGrams(merged);
  if (localBio > serverBio + 0.0001 || localFinal > serverFinal + 0.0001) {
    merged = {
      ...merged,
      ...pickExtractionPollWeightFields(localBatch),
    };
    if (Array.isArray(localBatch.completedTasks) && localBatch.completedTasks.length > 0) {
      merged.completedTasks = localBatch.completedTasks.map(String);
    }
  }

  return merged;
}

