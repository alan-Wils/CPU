import { store } from "./store";
import { apiDelete, apiGet, apiPost, apiRequest } from "./api";
import { pickSerializableUiFields } from "./jsonUiState";

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
}

function toUiPackaging(row: any) {
  const ui =
    row?.packagingUiState && typeof row.packagingUiState === "object"
      ? ({ ...row.packagingUiState } as Record<string, unknown>)
      : {};
  const { packagingUiState: _drop, ...rest } = row || {};
  void _drop;
  return {
    ...rest,
    ...ui,
    dbId: row.id,
    id: String((ui as any).id || row.id)
  };
}

export async function loadPackagingBatches() {
  try {
    const active = await apiGet<any>("/workflow/active", localStorage.getItem("token"));
    const relational = Array.isArray(active?.packaging) ? active.packaging : [];
    const mapped = uniqueById((relational || []).map(toUiPackaging));
    const locals = [
      ...rows(),
      ...(((store as any).inProgressPackagingBatches as any[]) || []),
      ...(((store as any).completedPackagingBatches as any[]) || [])
    ];
    const byDb = new Set(mapped.map((m: any) => normalizeId(m.dbId)));
    const pendingExtra = locals.filter((r: any) => !r?.dbId || !byDb.has(normalizeId(r.dbId)));
    const deduped = uniqueById([...mapped, ...pendingExtra]);
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
      const ui = { ...batch, dbId: created.id, extractionRunId };
      await apiRequest(`/workflow/packaging-lots/${created.id}`, {
        method: "PATCH",
        body: {
          packagingUiState: pickSerializableUiFields(ui, new Set(["dbId"]))
        },
        token: localStorage.getItem("token")
      });
      await loadPackagingBatches();
      return rows().find((r: any) => normalizeId(r?.dbId) === normalizeId(created.id)) || toUiPackaging(created);
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

export async function updatePackagingBatch(batchId: string, patch: any) {
  const local = rows().find(
    (row: any) => normalizeId(row?.id) === normalizeId(batchId) || normalizeId(row?.dbId) === normalizeId(batchId)
  );
  const dbId = String(patch?.dbId || local?.dbId || batchId);
  const packagingUiState = pickSerializableUiFields(patch, new Set(["dbId"]));
  await apiRequest(`/workflow/packaging-lots/${dbId}`, {
    method: "PATCH",
    body: {
      sku: typeof patch?.sku === "string" ? patch.sku : undefined,
      gramsPerUnit: Number.isFinite(Number(patch?.gramsPerUnit)) ? Number(patch.gramsPerUnit) : undefined,
      defaultTemplate: typeof patch?.defaultTemplate === "string" ? patch.defaultTemplate : undefined,
      packagingUiState: Object.keys(packagingUiState).length > 0 ? packagingUiState : undefined
    },
    token: localStorage.getItem("token")
  });
  await loadPackagingBatches();
  return patch;
}

export async function deletePackagingBatchRecord(batchId: string) {
  const local = rows().find(
    (row: any) => normalizeId(row?.id) === normalizeId(batchId) || normalizeId(row?.dbId) === normalizeId(batchId)
  );
  const dbId = String(local?.dbId || batchId);
  try {
    await apiDelete(`/workflow/packaging-lots/${dbId}`, localStorage.getItem("token"));
  } catch {
    /* ignore */
  }
  await loadPackagingBatches();
  return { ok: true };
}
