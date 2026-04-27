import { apiDelete, apiGet, apiPost, apiRequest } from "./api";
import { pickSerializableUiFields } from "./jsonUiState";
import { store } from "./store";
import type { CultivationBatch } from "./store";

function normalizeId(value: any) {
  return String(value || "").trim().toUpperCase();
}

export function markCultivationBatchCompletedLocal(batch: any) {
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

function toUiBatch(row: any) {
  const displayId =
    row?.strainAcronym && row?.batchChainCode
      ? `${String(row.strainAcronym).toUpperCase()}.${row.batchChainCode}`
      : row?.id;
  const ui =
    row?.cultivationUiState && typeof row.cultivationUiState === "object"
      ? (row.cultivationUiState as Record<string, unknown>)
      : {};
  const fromAuto = row?.autoStatus === "AUTO_COMPLETED";
  const plantsFromRow = Number(row?.expectedYieldGrams || 0);
  const plants = Number.isFinite(Number(ui.plants)) ? Number(ui.plants) : plantsFromRow;
  const originalPlants = Number.isFinite(Number(ui.originalPlants)) ? Number(ui.originalPlants) : plants;
  const base: Record<string, unknown> = {
    id: displayId,
    dbId: row?.id,
    strain: row?.strain || "Unknown",
    acronym: row?.strainAcronym || "",
    stage: fromAuto ? "Complete" : "Clone",
    status: fromAuto ? "Complete" : "Active",
    plants,
    originalPlants,
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
  const merged: CultivationBatch = {
    ...(base as CultivationBatch),
    ...(ui as CultivationBatch),
    id: displayId,
    dbId: row?.id,
    strain: row?.strain || "Unknown",
    acronym: row?.strainAcronym || "",
    createdAt: row?.createdAt as string | undefined
  };
  if (fromAuto) {
    merged.stage = "Complete";
    merged.status = "Complete";
  }
  return merged;
}

export async function loadCultivationBatches() {
  try {
    const active = await apiGet<any>("/workflow/active", localStorage.getItem("token"));
    const rows = Array.isArray(active?.cultivation) ? active.cultivation : [];
    const mapped = uniqueByNormalizedId(
      rows
        .map((row: any) => toUiBatch(row))
        .filter(isValidCultivationBatch)
    );
    store.cultivationBatches = mapped.filter((b: any) => b.status !== "Complete");
    store.completedCultivationBatches = mapped.filter((b: any) => b.status === "Complete");
    return mapped;
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
        table: Array.isArray(batch?.flowerTables)
          ? batch.flowerTables.join(",")
          : batch?.flowerTable || batch?.table || undefined
      },
      localStorage.getItem("token")
    );
    const baseUi = toUiBatch(created);
    const ui = {
      ...baseUi,
      stage: "Clone",
      status: "Active",
      plants: Number(batch?.plants || batch?.cloneCount || created?.expectedYieldGrams || 0),
      originalPlants: Number(batch?.plants || batch?.cloneCount || created?.expectedYieldGrams || 0)
    };
    await updateCultivationBatch(String(created.id), { ...(ui as any), dbId: created.id });
    await loadCultivationBatches();
    return findStoredBatchById(ui.id) || ui;
  } catch {
    const existing = (store.cultivationBatches || []).find(
      (b: any) => normalizeId(b?.id) === normalizeId(batch?.id)
    );
    if (existing) Object.assign(existing, batch);
    else store.cultivationBatches = [...(store.cultivationBatches || []), batch];
    return batch;
  }
}

export async function updateCultivationBatch(batchId: string, patch: any) {
  const target = findStoredBatchById(batchId);
  const dbId = String(patch?.dbId || target?.dbId || target?.id || batchId);
  const complete =
    patch?.complete === true ||
    String(patch?.status || "").toLowerCase() === "complete" ||
    String(patch?.stage || "").toLowerCase() === "complete";
  const cultivationUiState = pickSerializableUiFields(patch, new Set(["dbId"]));
  await apiRequest(`/workflow/cultivation-batches/${dbId}`, {
    method: "PATCH",
    body: {
      room: patch?.room ?? patch?.flowerRoom,
      bay: patch?.bay ?? patch?.flowerBay,
      table:
        patch?.table ??
        patch?.flowerTable ??
        (Array.isArray(patch?.flowerTables) ? patch.flowerTables.join(",") : undefined),
      complete: complete ? true : undefined,
      cultivationUiState: Object.keys(cultivationUiState).length > 0 ? cultivationUiState : undefined
    },
    token: localStorage.getItem("token")
  });
  await loadCultivationBatches();
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
  await loadCultivationBatches();
  return { ok: true };
}
