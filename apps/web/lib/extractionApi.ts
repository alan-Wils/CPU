import { store } from "./store";
import { apiGet, apiPost } from "./api";

function normalizeId(value: any) {
  return String(value || "").trim().toUpperCase();
}

function getRowKey(row: any) {
  return normalizeId(row?.dbId || row?.id);
}

function uniqueById(rows: any[]) {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const row of rows || []) {
    const id = getRowKey(row);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

function mergePreferLocal(localRows: any[], backendRows: any[]) {
  const byId = new Map<string, any>();
  const localList = Array.isArray(localRows) ? localRows : [];
  for (const row of backendRows || []) {
    const backendKey = normalizeId(row?.id);
    if (!backendKey) continue;
    const candidate =
      localList.find((l: any) => normalizeId(l?.dbId) === backendKey) ||
      localList.find(
        (l: any) =>
          !l?.dbId &&
          normalizeId(l?.cultivationBatchId) &&
          normalizeId(l?.cultivationBatchId) === normalizeId(row?.cultivationBatchId)
      ) ||
      null;
    if (candidate) {
      byId.set(backendKey, {
        ...row,
        ...candidate,
        dbId: row.id,
        // keep rich UI workflow/task state from local object
        completedTasks: candidate?.completedTasks ?? row?.completedTasks ?? [],
        taskData: candidate?.taskData ?? row?.taskData ?? {},
        status: candidate?.status ?? row?.status
      });
    } else {
      byId.set(backendKey, row);
    }
  }
  for (const row of localRows || []) {
    const id = getRowKey(row);
    if (!id) continue;
    const current = byId.get(id);
    byId.set(
      id,
      current
        ? {
            ...current,
            ...row,
            // keep rich UI workflow/task state from local object
            completedTasks: row?.completedTasks ?? current?.completedTasks ?? [],
            taskData: row?.taskData ?? current?.taskData ?? {},
            status: row?.status ?? current?.status
          }
        : row
    );
  }
  return Array.from(byId.values());
}

function isRenderableExtractionRow(row: any) {
  // Hide raw backend shells that don't have UI workflow fields yet.
  const hasUiFields =
    !!row?.name ||
    !!row?.productType ||
    !!row?.status ||
    Array.isArray(row?.sources) ||
    Array.isArray(row?.completedTasks);
  return hasUiFields;
}

function rows() {
  return (store as any).extractionBatches || [];
}

function setRows(next: any[]) {
  (store as any).extractionBatches = uniqueById(next || []);
  store.save?.();
}

export async function loadExtractionBatches() {
  try {
    const active = await apiGet<any>("/workflow/active", localStorage.getItem("token"));
    const relational = Array.isArray(active?.extraction) ? active.extraction : [];
    const merged = mergePreferLocal(rows(), relational);
    const deduped = uniqueById(merged).filter(isRenderableExtractionRow);
    setRows(deduped);
    return deduped;
  } catch {
    return uniqueById(rows()).filter(isRenderableExtractionRow);
  }
}

export async function createExtractionBatch(batch: any) {
  const cultivationBatchId = String(
    batch?.cultivationBatchId || batch?.sources?.[0]?.cultivationBatchId || batch?.sourceBatchId || ""
  );
  if (cultivationBatchId) {
    try {
      const created = await apiPost<any>(
        "/workflow/extraction-runs",
        { cultivationBatchId },
        localStorage.getItem("token")
      );
      const existing = rows().find((row: any) => normalizeId(row?.id) === normalizeId(batch?.id));
      if (existing) {
        Object.assign(existing, {
          dbId: created?.id,
          cultivationBatchId: created?.cultivationBatchId || cultivationBatchId
        });
        setRows(rows());
        return existing;
      }
      setRows([{ ...created, dbId: created?.id }, ...rows()]);
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

export async function updateExtractionBatch(batchId: string, patch: any) {
  setRows(rows().map((row: any) => (row?.id === batchId ? { ...row, ...patch } : row)));
  return patch;
}

export async function deleteExtractionBatchRecord(batchId: string) {
  setRows(rows().filter((row: any) => row?.id !== batchId));
  return { ok: true };
}
