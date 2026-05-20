/**
 * Display helpers for extraction batches: market lot code (strain acronym + date)
 * vs internal EXT-… run ids and linked cultivation source batches.
 */

/** `EXT-GMO0-051226` \u2192 `GMO.051226` (acronym.date, no run suffix). */
export function marketBatchCodeFromExtId(extId: string): string {
  const id = String(extId || "").trim();
  if (!id) return "";
  const m = id.match(/^EXT-([A-Za-z0-9]+)-(\d{6})(?:-(\d+))?$/i);
  if (!m) return "";
  const acronym = (m[1].replace(/0+$/, "") || m[1]).toUpperCase();
  return `${acronym}.${m[2]}`;
}

/** Primary label / card headline: saved market code, else acronym.date from EXT id. */
export function extractionBatchMarketBatchCode(batch: {
  id?: string;
  marketBatchCode?: string;
}): string {
  const saved = String(batch?.marketBatchCode ?? "").trim();
  if (saved) return saved;
  const fromExt = marketBatchCodeFromExtId(String(batch?.id ?? "").trim());
  if (fromExt) return fromExt;
  const id = String(batch?.id ?? "").trim();
  return id || "\u2014";
}

export function collectExtractionCultivationSourceLabels(
  batch: {
    cultivationBatchId?: string;
    blendCultivationBatchIds?: unknown;
    sources?: Array<{ sourceId?: string }>;
  },
  resolveSource?: (sourceId: string) => { source?: string } | null | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw: unknown) => {
    const id = String(raw ?? "").trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };

  if (Array.isArray(batch.blendCultivationBatchIds)) {
    for (const id of batch.blendCultivationBatchIds) add(id);
  }
  add(batch.cultivationBatchId);

  if (Array.isArray(batch.sources)) {
    for (const row of batch.sources) {
      const sid = String(row?.sourceId ?? "").trim();
      if (!sid) continue;
      const src = resolveSource?.(sid);
      if (src?.source) add(src.source);
    }
  }

  return out;
}

export function formatExtractionCultivationSourceFooter(labels: string[]): string {
  if (labels.length === 0) return "";
  return labels.join(" \u00b7 ");
}

/** Saved `marketBatchCode` on the batch record (not derived from EXT id). */
export function extractionBatchSavedMarketBatchCode(batch: {
  marketBatchCode?: string;
}): string {
  return String(batch?.marketBatchCode ?? "").trim();
}

function marketBatchCodesMatch(a: string, b: string): boolean {
  const left = String(a || "").trim();
  const right = String(b || "").trim();
  if (!left || !right) return false;
  return left.toLowerCase() === right.toLowerCase();
}

/**
 * Another active extraction batch already uses this market lot code.
 * Compares explicit `marketBatchCode` only \u2014 not display fallbacks from EXT ids.
 */
export function findActiveExtractionBatchWithMarketCode(
  batches: any[],
  marketBatchCode: string,
  excludeBatchId: string,
): any | null {
  const want = String(marketBatchCode || "").trim();
  if (!want) return null;
  const exclude = String(excludeBatchId || "").trim();
  for (const batch of batches || []) {
    const id = String(batch?.id || "").trim();
    if (!id || id === exclude) continue;
    const saved = extractionBatchSavedMarketBatchCode(batch);
    if (saved && marketBatchCodesMatch(saved, want)) {
      return batch;
    }
  }
  return null;
}
