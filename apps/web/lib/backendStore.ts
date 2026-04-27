import { apiGet, apiPut } from "./api";
import { store } from "./store";
import { logCpuDiagnosticsIfEnabled } from "./cpuDiagnostics";

let lastWorkflowRevision: string | null = null;

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

/**
 * Lightweight refresh trigger: workflow entities are hydrated by domain APIs
 * (cultivationApi, extractionApi, etc.). Avoid legacy /store JSON as source of truth.
 */
export async function loadBackendStore() {
  logCpuDiagnosticsIfEnabled("loadBackendStore");
  try {
    const token = localStorage.getItem("token");
    await apiGet<any>("/activity/all", token).catch(() => ({ items: [] }));
    return snapshot();
  } catch {
    return snapshot();
  }
}

export async function saveBackendStore(options?: { forceRemote?: boolean }) {
  store.save?.();
  const shouldWriteCompatibilityStore =
    (process.env.NEXT_PUBLIC_ENABLE_STORE_COMPAT_WRITE || "").toLowerCase() === "true" ||
    Boolean(options?.forceRemote);
  if (shouldWriteCompatibilityStore) {
    await apiPut<any>("/store", snapshot(), localStorage.getItem("token"));
  }
  return snapshot();
}

export async function hasCompanyStoreChanged() {
  try {
    const token = localStorage.getItem("token");
    const v = await apiGet<{ revision: string }>("/workflow/revision", token);
    const rev = v?.revision ?? "0";
    if (lastWorkflowRevision === null) {
      lastWorkflowRevision = rev;
      return true;
    }
    if (rev !== lastWorkflowRevision) {
      lastWorkflowRevision = rev;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
