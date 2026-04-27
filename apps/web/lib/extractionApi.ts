import { apiDelete, apiGet, apiPost, apiRequest } from "./api";
import { pickSerializableUiFields } from "./jsonUiState";
import { store } from "./store";

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

function toUiExtraction(row: any) {
  const ui =
    row?.extractionUiState && typeof row.extractionUiState === "object"
      ? ({ ...row.extractionUiState } as Record<string, unknown>)
      : {};
  const { extractionUiState: _drop, ...rest } = row || {};
  void _drop;
  return {
    ...rest,
    ...ui,
    dbId: row.id,
    id: String((ui as any).id || row.id)
  };
}

function isRenderableExtractionRow(row: any) {
  if (String(row?.phase || "").toUpperCase() === "COMPLETED") return false;
  return Boolean(row?.dbId || row?.id);
}

function rows() {
  return (store as any).extractionBatches || [];
}

function setRows(next: any[]) {
  (store as any).extractionBatches = uniqueById(next || []);
}

export async function loadExtractionBatches() {
  try {
    const active = await apiGet<any>("/workflow/active", localStorage.getItem("token"));
    const relational = Array.isArray(active?.extraction) ? active.extraction : [];
    const mapped = uniqueById((relational || []).map(toUiExtraction));
    const pending = (rows() || []).filter((r: any) => !r?.dbId);
    const merged = uniqueById([...pending, ...mapped]);
    const deduped = merged.filter(isRenderableExtractionRow);
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
        await updateExtractionBatch(String(existing.dbId || created.id), existing);
        return existing;
      }
      const ui = {
        ...batch,
        dbId: created.id,
        cultivationBatchId: created.cultivationBatchId || cultivationBatchId
      };
      await apiRequest(`/workflow/extraction-runs/${created.id}`, {
        method: "PATCH",
        body: {
          extractionUiState: pickSerializableUiFields(ui, new Set(["dbId"]))
        },
        token: localStorage.getItem("token")
      });
      await loadExtractionBatches();
      return rows().find((r: any) => normalizeId(r?.dbId) === normalizeId(created.id)) || toUiExtraction(created);
    } catch {
      /* fall through */
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
  const local = rows().find((row: any) => normalizeId(row?.id) === normalizeId(batchId) || normalizeId(row?.dbId) === normalizeId(batchId));
  const dbId = String(patch?.dbId || local?.dbId || batchId);
  const extractionUiState = pickSerializableUiFields(patch, new Set(["dbId"]));
  await apiRequest(`/workflow/extraction-runs/${dbId}`, {
    method: "PATCH",
    body: {
      method: typeof patch?.method === "string" ? patch.method : undefined,
      supplyUsed: typeof patch?.supplyUsed === "string" ? patch.supplyUsed : undefined,
      extractionUiState: Object.keys(extractionUiState).length > 0 ? extractionUiState : undefined
    },
    token: localStorage.getItem("token")
  });
  await loadExtractionBatches();
  return patch;
}

export async function deleteExtractionBatchRecord(batchId: string) {
  const local = rows().find(
    (row: any) => normalizeId(row?.id) === normalizeId(batchId) || normalizeId(row?.dbId) === normalizeId(batchId)
  );
  const dbId = String(local?.dbId || batchId);
  try {
    await apiDelete(`/workflow/extraction-runs/${dbId}`, localStorage.getItem("token"));
  } catch {
    /* ignore */
  }
  await loadExtractionBatches();
  return { ok: true };
}
