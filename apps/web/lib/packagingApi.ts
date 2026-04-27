import { store } from "./store";
import { apiGet, apiPost } from "./api";

function normalizeId(value: any) {
  return String(value || "").trim().toUpperCase();
}

function uniqueById(rows: any[]) {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const row of rows || []) {
    const id = normalizeId(row?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

function rows() {
  return store.packagingBatches || [];
}

function setRows(next: any[]) {
  store.packagingBatches = uniqueById(next || []);
  store.save?.();
}

export async function loadPackagingBatches() {
  try {
    const active = await apiGet<any>("/workflow/active", localStorage.getItem("token"));
    const relational = Array.isArray(active?.packaging) ? active.packaging : [];
    const localReady = Array.isArray(store.packagingBatches) ? store.packagingBatches : [];
    const localInProgress = Array.isArray((store as any).inProgressPackagingBatches)
      ? (store as any).inProgressPackagingBatches
      : [];
    const localCompleted = Array.isArray((store as any).completedPackagingBatches)
      ? (store as any).completedPackagingBatches
      : [];
    // Merge relational rows with current local packaging candidates so
    // pending/ready rows don't flash then disappear on polling.
    const deduped = uniqueById([...localReady, ...localInProgress, ...localCompleted, ...relational]);
    setRows(deduped);
    return deduped;
  } catch {
    return uniqueById(rows());
  }
}

export async function createPackagingBatch(batch: any) {
  const extractionRunId = String(batch?.extractionRunId || batch?.sourceBatchId || "");
  if (extractionRunId) {
    try {
      const created = await apiPost<any>(
        `/workflow/extraction-runs/${extractionRunId}/packaging`,
        {
          sku: String(batch?.sku || batch?.name || "SKU"),
          gramsPerUnit: Number(batch?.gramsPerUnit || 1),
          defaultTemplate: batch?.defaultTemplate || undefined
        },
        localStorage.getItem("token")
      );
      setRows([created, ...rows()]);
      return created;
    } catch {
      // fallback below
    }
  }
  const existing = rows().find((row: any) => normalizeId(row?.id) === normalizeId(batch?.id));
  if (existing) {
    Object.assign(existing, batch);
    setRows(rows());
  } else {
    setRows([batch, ...rows()]);
  }
  return batch;
}

export async function updatePackagingBatch(batchId: string, patch: any) {
  setRows(rows().map((row: any) => (row?.id === batchId ? { ...row, ...patch } : row)));
  return patch;
}

export async function deletePackagingBatchRecord(batchId: string) {
  setRows(rows().filter((row: any) => row?.id !== batchId));
  return { ok: true };
}
