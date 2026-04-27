import { apiGet, apiPut } from "./api";
import { store } from "./store";

let lastStoreUpdatedAt: string | null = null;

function isValidCultivationBatch(batch: any) {
  return (
    batch &&
    typeof batch.id === "string" &&
    batch.id.length > 0 &&
    typeof batch.strain === "string" &&
    batch.strain.length > 0 &&
    typeof batch.stage === "string" &&
    batch.stage.length > 0 &&
    Number.isFinite(Number(batch.plants))
  );
}

function snapshot() {
  return {
    cultivationBatches: store.cultivationBatches || [],
    completedCultivationBatches: store.completedCultivationBatches || [],
    dryFlowerBatches: store.dryFlowerBatches || [],
    productionBatches: store.productionBatches || [],
    sourceBatches: store.sourceBatches || [],
    extractionBatches: (store as any).extractionBatches || [],
    packagingBatches: store.packagingBatches || [],
    logs: store.logs || []
  };
}

export async function loadBackendStore() {
  try {
    const token = localStorage.getItem("token");
    const [active, activity] = await Promise.all([
      apiGet<any>("/workflow/active", token).catch(() => ({})),
      apiGet<any>("/activity/all", token).catch(() => ({ items: [] }))
    ]);

    // Cultivation lists are hydrated by cultivationApi. Keep current in-memory
    // values here so workflow-progress fields can be preserved during polling.

    // Do not inject raw sourcePackage rows here. Extraction source material
    // is hydrated by sourceBatchApi with proper filtering and unit mapping.

    // Do not hard-reset extraction/packaging lists here; those pages use
    // dedicated adapters that merge relational rows with local in-progress
    // task state. Hard resets cause newly-created pending batches to disappear.
    // Do not overwrite operational page logs with compact activity feed items.
    // Logs page fetches activity directly.

    return snapshot();
  } catch {
    return snapshot();
  }
}

export async function saveBackendStore(options?: { forceRemote?: boolean }) {
  const payload = snapshot();
  store.save?.();
  // Compatibility mode only: avoid using /store as primary write path.
  // Enable explicit compatibility writes only when requested.
  const shouldWriteCompatibilityStore =
    (process.env.NEXT_PUBLIC_ENABLE_STORE_COMPAT_WRITE || "").toLowerCase() === "true" ||
    Boolean(options?.forceRemote);
  if (shouldWriteCompatibilityStore) {
    const saved = await apiPut<any>("/store", payload, localStorage.getItem("token"));
    lastStoreUpdatedAt = saved?._meta?.updatedAt ?? lastStoreUpdatedAt;
  }
  return payload;
}

export async function hasCompanyStoreChanged() {
  try {
    const version = await apiGet<{ updatedAt: string | null }>("/activity/version", localStorage.getItem("token"));
    const next = version?.updatedAt ?? null;
    if (!lastStoreUpdatedAt && next) {
      lastStoreUpdatedAt = next;
      return true;
    }
    if (next && next !== lastStoreUpdatedAt) {
      lastStoreUpdatedAt = next;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
