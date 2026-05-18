/** Source material package tags on packaging / extraction lots (FF-…, not product labels). */

export function parseSourcePackageIdsInput(text: string): string[] {
  return [
    ...new Set(
      String(text || "")
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  ];
}

export function sourcePackageIdsFromBatch(batch: any): string[] {
  if (Array.isArray(batch?.extractionSources) && batch.extractionSources.length > 0) {
    const ids: string[] = batch.extractionSources
      .map((r: any) => String(r?.sourceId ?? "").trim())
      .filter((id: string) => id.length > 0);
    if (ids.length > 0) return [...new Set(ids)];
  }

  const raw = String(batch?.source ?? "").trim();
  if (raw) {
    return parseSourcePackageIdsInput(raw);
  }

  return [];
}

export function formatSourcePackageIdsForInput(batch: any): string {
  return sourcePackageIdsFromBatch(batch).join(", ");
}

/** Apply comma-separated source package ids to a packaging or extraction batch row. */
export function applySourcePackageIdsToBatch(batch: any, ids: string[]): any {
  const prevById = new Map<string, any>();
  for (const row of batch?.extractionSources || []) {
    const id = String(row?.sourceId ?? "").trim();
    if (id) prevById.set(id, row);
  }

  const extractionSources = ids.map((sourceId) => {
    const prev = prevById.get(sourceId);
    if (prev && typeof prev === "object") {
      return { ...prev, sourceId };
    }
    return { sourceId, amountUsed: 0 };
  });

  return {
    ...batch,
    source: ids.join(", "),
    extractionSources,
  };
}
