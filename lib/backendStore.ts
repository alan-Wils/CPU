import { apiRequest } from "@/lib/api";
import { store } from "@/lib/store";

const STORE_KEYS = [
  "cultivationBatches",
  "completedCultivationBatches",
  "dryFlowerBatches",
  "productionBatches",
  "sourceBatches",
  "completedSourceBatches",
  "extractionBatches",
  "packagingBatches",
  "inProgressPackagingBatches",
  "completedPackagingBatches",
  "logs",
];

export function getStoreSnapshot() {
  const snapshot: any = {};

  for (const key of STORE_KEYS) {
    snapshot[key] = Array.isArray((store as any)[key])
      ? (store as any)[key]
      : [];
  }

  return snapshot;
}

export function applyStoreSnapshot(snapshot: any) {
  if (!snapshot || typeof snapshot !== "object") return;

  for (const key of STORE_KEYS) {
    (store as any)[key] = Array.isArray(snapshot[key]) ? snapshot[key] : [];
  }
}

export async function loadBackendStore() {
  const snapshot = await apiRequest("/api/sync");
  applyStoreSnapshot(snapshot);
  return snapshot;
}

export async function saveBackendStore() {
  const snapshot = getStoreSnapshot();

  return apiRequest("/api/sync", {
    method: "POST",
    body: snapshot,
  });
}