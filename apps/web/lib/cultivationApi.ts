import { apiDelete, apiGet, apiPost, apiRequest } from "./api";
import { store } from "./store";
import type { CultivationBatch } from "./store";

function normalizeId(value: any) {
  return String(value || "").trim().toUpperCase();
}

export function markCultivationBatchCompletedLocal(batch: any) {
  // Completion is now persisted to backend, so local-only overrides are disabled.
  return batch;
}

function isValidCultivationBatch(batch: any) {
  return (
    batch &&
    typeof batch.id === "string" &&
    normalizeId(batch.id).length > 0 &&
    typeof batch.strain === "string" &&
    batch.strain.trim().length > 0 &&
    typeof batch.stage === "string" &&
    batch.stage.trim().length > 0 &&
    Number.isFinite(Number(batch.plants))
  );
}

function uniqueByNormalizedId(rows: any[]) {
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

function allBatches() {
  const merged = [...(store.completedCultivationBatches || []), ...(store.cultivationBatches || [])];
  return uniqueByNormalizedId(merged.filter(isValidCultivationBatch));
}

function findStoredBatchById(batchId: string) {
  const id = normalizeId(batchId);
  return allBatches().find((b: any) => normalizeId(b?.id) === id || normalizeId(b?.dbId) === id) || null;
}

function findExistingForDbRow(row: any, existing: any[]) {
  const dbId = normalizeId(row?.id);
  const displayId =
    row?.strainAcronym && row?.batchChainCode
      ? normalizeId(`${String(row.strainAcronym).toUpperCase()}.${row.batchChainCode}`)
      : "";
  return (
    (existing || []).find(
      (b: any) => normalizeId(b?.dbId) === dbId || normalizeId(b?.id) === displayId || normalizeId(b?.id) === dbId
    ) || null
  );
}

function toUiBatch(row: any) {
  const displayId =
    row?.strainAcronym && row?.batchChainCode
      ? `${String(row.strainAcronym).toUpperCase()}.${row.batchChainCode}`
      : row?.id;
  const plants = Number(row?.expectedYieldGrams || 0);
  return {
    id: displayId,
    dbId: row?.id,
    strain: row?.strain || "Unknown",
    acronym: row?.strainAcronym || "",
    stage: row?.autoStatus === "AUTO_COMPLETED" ? "Complete" : "Clone",
    status: row?.autoStatus === "AUTO_COMPLETED" ? "Complete" : "Active",
    plants,
    originalPlants: plants,
    room: row?.room || "",
    bay: row?.bay || "",
    table: row?.table || "",
    createdAt: row?.createdAt,
    metrcSourceMotherPlantTag: undefined,
    metrcFirstPlantTag: undefined,
    metrcPlantTags: [],
    metrcTagCreatedAt: undefined,
    metrcTagPlantCount: undefined,
    metrcLocationName: undefined,
    metrcSublocationName: undefined,
    metrcActualDate: undefined,
    metrcSyncStatus: "not_synced"
  };
}

export async function loadCultivationBatches() {
  try {
    const active = await apiGet<any>("/workflow/active", localStorage.getItem("token"));
    const rows = Array.isArray(active?.cultivation) ? active.cultivation : [];
    const existing = allBatches();
    // #region agent log
    fetch("http://127.0.0.1:7632/ingest/2f728e3e-c43e-4540-9407-a3bbee548e0f", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6beeea" },
      body: JSON.stringify({
        sessionId: "6beeea",
        runId: "pre-fix",
        hypothesisId: "H2",
        location: "cultivationApi.ts:loadCultivationBatches:input",
        message: "Received cultivation rows from workflow active API",
        data: {
          backendCultivationCount: rows.length,
          existingLocalCount: existing.length,
          backendSample: rows.slice(0, 5).map((r: any) => ({
            id: String(r?.id || ""),
            acronym: String(r?.strainAcronym || ""),
            chainCode: String(r?.batchChainCode || ""),
            autoStatus: String(r?.autoStatus || "")
          }))
        },
        timestamp: Date.now()
      })
    }).catch(() => {});
    // #endregion
    const mapped = uniqueByNormalizedId(
      rows
        .map((row: any) => {
          const base = toUiBatch(row);
          const prior = findExistingForDbRow(row, existing);
          if (!prior) return base;
          const backendIsComplete = String(base?.status || "").toLowerCase() === "complete";
          // Keep workflow-progress fields from current UI state so backend sync
          // does not reset clone/veg/flower task progress during polling.
          const mergedRow: CultivationBatch = {
            ...base,
            stage: backendIsComplete ? "Complete" : prior.stage ?? base.stage,
            status: backendIsComplete ? "Complete" : prior.status ?? base.status,
            plants: Number.isFinite(Number(prior.plants)) ? Number(prior.plants) : base.plants,
            originalPlants: Number.isFinite(Number(prior.originalPlants))
              ? Number(prior.originalPlants)
              : base.originalPlants,
            flowerRoom: prior.flowerRoom ?? base.room,
            flowerBay: prior.flowerBay ?? base.bay,
            flowerTable: prior.flowerTable ?? base.table,
            flowerTables: Array.isArray(prior.flowerTables) ? prior.flowerTables : prior.flowerTables ?? [],
            completedAt: backendIsComplete ? prior?.completedAt || "" : undefined,
            metrcSourceMotherPlantTag: String(prior?.metrcSourceMotherPlantTag || "").trim() || undefined,
            metrcFirstPlantTag: String(prior?.metrcFirstPlantTag || "").trim() || undefined,
            metrcPlantTags: Array.isArray(prior?.metrcPlantTags) ? prior.metrcPlantTags : [],
            metrcTagCreatedAt: String(prior?.metrcTagCreatedAt || "").trim() || undefined,
            metrcTagPlantCount:
              Number.isFinite(Number(prior?.metrcTagPlantCount)) ? Number(prior.metrcTagPlantCount) : undefined,
            metrcLocationName: String(prior?.metrcLocationName || "").trim() || undefined,
            metrcSublocationName: String(prior?.metrcSublocationName || "").trim() || undefined,
            metrcActualDate: String(prior?.metrcActualDate || "").trim() || undefined,
            metrcSyncStatus: (prior?.metrcSyncStatus as CultivationBatch["metrcSyncStatus"]) || "not_synced"
          };
          return mergedRow;
        })
        .filter(isValidCultivationBatch)
    );
    const mappedKeys = new Set(
      mapped.map((m: any) => normalizeId(m.dbId || m.id)).filter(Boolean)
    );
    for (const prior of existing) {
      if (String(prior?.status || "").toLowerCase() !== "complete") continue;
      const key = normalizeId(prior.dbId || prior.id);
      if (!key || mappedKeys.has(key)) continue;
      if (!isValidCultivationBatch(prior)) continue;
      mapped.push(prior);
      mappedKeys.add(key);
    }
    const mergedList = uniqueByNormalizedId(mapped);
    // #region agent log
    fetch("http://127.0.0.1:7632/ingest/2f728e3e-c43e-4540-9407-a3bbee548e0f", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6beeea" },
      body: JSON.stringify({
        sessionId: "6beeea",
        runId: "pre-fix",
        hypothesisId: "H3",
        location: "cultivationApi.ts:loadCultivationBatches:output",
        message: "Mapped cultivation rows after merge/dedupe/filter",
        data: {
          mappedCount: mergedList.length,
          activeCount: mergedList.filter((b: any) => b?.status !== "Complete").length,
          completeCount: mergedList.filter((b: any) => b?.status === "Complete").length,
          mappedSample: mergedList.slice(0, 8).map((b: any) => ({
            id: String(b?.id || ""),
            dbId: String(b?.dbId || ""),
            status: String(b?.status || ""),
            stage: String(b?.stage || ""),
            plants: Number(b?.plants || 0)
          }))
        },
        timestamp: Date.now()
      })
    }).catch(() => {});
    // #endregion
    store.cultivationBatches = mergedList.filter((b: any) => b.status !== "Complete");
    store.completedCultivationBatches = mergedList.filter((b: any) => b.status === "Complete");
    return mergedList;
  } catch {
    return [];
  }
}

export async function createCultivationBatch(batch: any) {
  const plantedAt = batch?.cloneDate || new Date().toISOString().slice(0, 10);
  const expected = Number(batch?.cloneCount || batch?.plants || 0);
  const grams = Math.max(expected, 1);
  try {
    const created = await apiPost<any>(
      "/workflow/cultivation-batches",
      {
        strain: String(batch?.strain || "Unknown"),
        strainAcronym: String(batch?.acronym || "").slice(0, 6) || undefined,
        plantedAt,
        aGradeFlowerGrams: grams,
        popcornGrams: 0,
        trimGrams: 0,
        freshFrozenGrams: 0,
        room: batch?.flowerRoom || batch?.room || undefined,
        bay: batch?.flowerBay || batch?.bay || undefined,
        table: Array.isArray(batch?.flowerTables) ? batch.flowerTables.join(",") : batch?.flowerTable || batch?.table || undefined
      },
      localStorage.getItem("token")
    );
    const ui = {
      ...toUiBatch(created),
      // Preserve existing UI task flow defaults exactly
      stage: "Clone",
      status: "Active",
      plants: Number(batch?.plants || batch?.cloneCount || created?.expectedYieldGrams || 0),
      originalPlants: Number(batch?.plants || batch?.cloneCount || created?.expectedYieldGrams || 0)
    };
    store.cultivationBatches = uniqueByNormalizedId([ui, ...(store.cultivationBatches || [])]);
    store.save?.();
    return ui;
  } catch {
    const existing = (store.cultivationBatches || []).find(
      (b: any) => normalizeId(b?.id) === normalizeId(batch?.id)
    );
    if (existing) Object.assign(existing, batch);
    else store.cultivationBatches = [...(store.cultivationBatches || []), batch];
    store.save?.();
    return batch;
  }
}

export async function updateCultivationBatch(batchId: string, patch: any) {
  const target = findStoredBatchById(batchId);
  const dbId = String(target?.dbId || target?.id || batchId);
  await apiRequest(
    `/workflow/cultivation-batches/${dbId}`,
    {
      method: "PATCH",
      body: {
        room: patch?.room ?? patch?.flowerRoom,
        bay: patch?.bay ?? patch?.flowerBay,
        table:
          patch?.table ??
          patch?.flowerTable ??
          (Array.isArray(patch?.flowerTables) ? patch.flowerTables.join(",") : undefined),
        complete: patch?.complete === true ? true : undefined
      },
      token: localStorage.getItem("token")
    }
  );
  const merge = (rows: any[]) =>
    rows.map((row) =>
      normalizeId(row?.id) === normalizeId(batchId) || normalizeId(row?.dbId) === normalizeId(dbId)
        ? { ...row, ...patch }
        : row
    );
  store.cultivationBatches = merge(store.cultivationBatches || []);
  store.completedCultivationBatches = merge(store.completedCultivationBatches || []);
  store.save?.();
  return patch;
}

function rowMatchesBatchDelete(row: any, displayOrLookupId: string, resolvedDbId: string) {
  const d = normalizeId(displayOrLookupId);
  const db = normalizeId(resolvedDbId);
  return (
    normalizeId(row?.id) === d ||
    normalizeId(row?.dbId) === d ||
    (db && normalizeId(row?.dbId) === db) ||
    (db && normalizeId(row?.id) === db)
  );
}

export async function deleteCultivationBatch(batchId: string) {
  const target = findStoredBatchById(batchId);
  const dbId = String(target?.dbId || target?.id || batchId);
  await apiDelete(`/workflow/cultivation-batches/${dbId}`, localStorage.getItem("token"));
  const pred = (row: any) => !rowMatchesBatchDelete(row, batchId, dbId);
  store.cultivationBatches = (store.cultivationBatches || []).filter(pred);
  store.completedCultivationBatches = (store.completedCultivationBatches || []).filter(pred);
  store.save?.();
  return { ok: true };
}
