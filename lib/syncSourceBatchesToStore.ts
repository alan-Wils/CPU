import { isActiveExtractionSourceBatch } from "@/lib/sourceBatchActive";

type StoreLike = {
  sourceBatches?: unknown[];
  productionBatches?: unknown[];
};

/** Merge server/API source batch rows into in-memory store (by id). */
export function mergeSourceBatchRowsIntoStore(
  target: StoreLike,
  incoming: unknown[],
): void {
  if (!incoming.length) return;
  const byId = new Map<string, Record<string, unknown>>();
  for (const raw of target.sourceBatches || []) {
    const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    const id = String(row?.id || "").trim();
    if (id) byId.set(id, { ...row });
  }
  for (const raw of incoming) {
    const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    const id = String(row?.id || "").trim();
    if (!id) continue;
    const prev = byId.get(id) || {};
    byId.set(id, { ...prev, ...row });
  }
  target.sourceBatches = [...byId.values()];
}

/**
 * Mirror active Fresh Frozen / Dry Trim sources into `productionBatches`
 * (same rules as Cultivation + Extraction polling).
 */
export function syncProductionBatchesFromFfTrimSources(
  target: StoreLike,
  sourceList: unknown[],
): void {
  const activeFfTrimIds = new Set<string>();
  for (const src of sourceList) {
    const typ = String((src as { type?: unknown })?.type || "");
    if (typ !== "Fresh Frozen" && typ !== "Dry Trim") continue;
    if (!isActiveExtractionSourceBatch(src)) continue;
    const id = String((src as { id?: unknown })?.id || "");
    if (id) activeFfTrimIds.add(id);
  }

  target.productionBatches = (target.productionBatches || []).filter((p: unknown) => {
    const typ = String((p as { type?: unknown })?.type || "");
    if (typ !== "Fresh Frozen" && typ !== "Dry Trim") return true;
    const id = String((p as { id?: unknown })?.id || "");
    return Boolean(id && activeFfTrimIds.has(id));
  });

  const prodIds = new Set(
    (target.productionBatches || []).map((b: unknown) =>
      String((b as { id?: unknown })?.id || ""),
    ),
  );

  for (const src of sourceList) {
    const typ = String((src as { type?: unknown })?.type || "");
    if (typ !== "Fresh Frozen" && typ !== "Dry Trim") continue;
    if (!isActiveExtractionSourceBatch(src)) continue;
    const id = String((src as { id?: unknown })?.id || "");
    if (!id || prodIds.has(id)) continue;
    target.productionBatches = [src, ...(target.productionBatches || [])];
    prodIds.add(id);
  }
}

export function applyFfTrimSourceListToStore(target: StoreLike, sourceList: unknown[]): void {
  mergeSourceBatchRowsIntoStore(target, sourceList);
  syncProductionBatchesFromFfTrimSources(target, sourceList);
}
