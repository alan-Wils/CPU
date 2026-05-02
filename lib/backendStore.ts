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

export type ApplyStoreSnapshotOptions = {
  /**
   * When true, snapshot does not overwrite these keys (keep in-memory values until
   * workflow API hydrates them — avoids Veg/Flower flicker from stale CompanyStore JSON).
   */
  omitCultivation?: boolean;
};

export function applyStoreSnapshot(snapshot: any, options?: ApplyStoreSnapshotOptions) {
  if (!snapshot || typeof snapshot !== "object") return;

  const omitCult = Boolean(options?.omitCultivation);

  for (const key of STORE_KEYS) {
    if (omitCult && (key === "cultivationBatches" || key === "completedCultivationBatches")) {
      continue;
    }
    (store as any)[key] = Array.isArray(snapshot[key]) ? snapshot[key] : [];
  }
}

/** `@cpu/api` exposes `/api/store` (legacy Node backend used `/api/sync`). */
export async function loadBackendStore(options?: ApplyStoreSnapshotOptions) {
  const snapshot = await apiRequest("/api/store");
  applyStoreSnapshot(snapshot, options);
  return snapshot;
}

export async function saveBackendStore() {
  const snapshot = getStoreSnapshot();

  return apiRequest("/api/store", {
    method: "PUT",
    body: snapshot,
  });
}