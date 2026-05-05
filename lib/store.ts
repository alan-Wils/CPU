/**
 * In-memory client store. Arrays start empty so pages do not flash demo rows
 * before `loadBackendStore` / workflow API hydration runs.
 */
export const store = {
  cultivationBatches: [] as unknown[],
  sourceBatches: [] as unknown[],
  extractionBatches: [] as unknown[],
  packagingBatches: [] as unknown[],
  logs: [] as unknown[],
};
