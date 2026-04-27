import { apiDelete, apiGet, apiPost, apiRequest } from "./api";
import { store } from "./store";
import type { CultivationBatch } from "./store";

const COMPLETED_OVERRIDE_KEY = "cpuCompletedCultivationOverrides";

function normalizeId(value: any) {
  return String(value || "").trim().toUpperCase();
}

function readCompletedOverrides(): Record<string, { completedAt?: string }> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(COMPLETED_OVERRIDE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeCompletedOverrides(next: Record<string, { completedAt?: string }>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(COMPLETED_OVERRIDE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function completionKeysForBatch(batch: any): string[] {
  return [normalizeId(batch?.id), normalizeId(batch?.dbId)].filter(Boolean);
}

function completionKeysForBackendRow(row: any): string[] {
  const displayId =
    row?.strainAcronym && row?.batchChainCode
      ? `${String(row.strainAcronym).toUpperCase()}.${row.batchChainCode}`
      : row?.id;
  return [normalizeId(displayId), normalizeId(row?.id)].filter(Boolean);
}

export function markCultivationBatchCompletedLocal(batch: any) {
  const now = String(batch?.completedAt || new Date().toLocaleString());
  const current = readCompletedOverrides();
  for (const key of completionKeysForBatch(batch)) {
    current[key] = { completedAt: now };
  }
  writeCompletedOverrides(current);
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
  // Prefer completed rows first so local completion state wins on dedupe.
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
    const completedOverrides = readCompletedOverrides();
    const mapped = uniqueByNormalizedId(
      rows
        .map((row: any) => {
          const base = toUiBatch(row);
          const prior = findExistingForDbRow(row, existing);
          const hasCompletionOverride = completionKeysForBackendRow(row).some(
            (key) => Boolean(completedOverrides[key])
          );
          const forceComplete =
            hasCompletionOverride ||
            String(prior?.status || "").toLowerCase() === "complete" ||
            String(prior?.stage || "").toLowerCase() === "complete";
          const baseOrCompleted = forceComplete
            ? {
                ...base,
                stage: "Complete",
                status: "Complete",
                completedAt:
                  prior?.completedAt ||
                  completionKeysForBackendRow(row).map((k) => completedOverrides[k]?.completedAt).find(Boolean) ||
                  ""
              }
            : base;
          if (!prior) return baseOrCompleted;
          // Keep workflow-progress fields from current UI state so backend sync
          // does not reset clone/veg/flower task progress during polling.
          const mergedRow: CultivationBatch = {
            ...baseOrCompleted,
            stage: forceComplete ? "Complete" : prior.stage ?? baseOrCompleted.stage,
            status: forceComplete ? "Complete" : prior.status ?? baseOrCompleted.status,
            plants: Number.isFinite(Number(prior.plants)) ? Number(prior.plants) : baseOrCompleted.plants,
            originalPlants: Number.isFinite(Number(prior.originalPlants))
              ? Number(prior.originalPlants)
              : baseOrCompleted.originalPlants,
            flowerRoom: prior.flowerRoom ?? baseOrCompleted.room,
            flowerBay: prior.flowerBay ?? baseOrCompleted.bay,
            flowerTable: prior.flowerTable ?? baseOrCompleted.table,
            flowerTables: Array.isArray(prior.flowerTables) ? prior.flowerTables : prior.flowerTables ?? [],
            completedAt:
              prior?.completedAt ||
              completionKeysForBackendRow(row).map((k) => completedOverrides[k]?.completedAt).find(Boolean) ||
              (baseOrCompleted as any).completedAt,
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
          (Array.isArray(patch?.flowerTables) ? patch.flowerTables.join(",") : undefined)
      },
      token: localStorage.getItem("token")
    }
  );
  const merge = (rows: any[]) => rows.map((row) => (row?.id === batchId ? { ...row, ...patch } : row));
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
