import { apiRequest, getLogs } from "@/lib/api";
import { store } from "@/lib/store";

/**
 * When `NEXT_PUBLIC_SERVER_DATABASE_ONLY` is `true` / `1` / `yes`, the UI does **not** send
 * `PUT /api/store` (the company JSON snapshot). Writes go through entity APIs only
 * (`/api/cultivation`, `/api/extraction`, `/api/packaging`, `/api/source-batches`, `/api/logs`, …),
 * which persist in PostgreSQL via `@cpu/api`.
 *
 * `loadBackendStore()` still runs so legacy slices only kept in the company store
 * (e.g. dry-flower / production staging rows) continue to hydrate until those flows are migrated.
 */
export function shouldWriteCompanyStoreSnapshot(): boolean {
  if (typeof process === "undefined")
    return true;
  const v = String(process.env.NEXT_PUBLIC_SERVER_DATABASE_ONLY || "")
    .trim()
    .toLowerCase();
  if (v === "1" || v === "true" || v === "yes")
    return false;
  return true;
}

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

/**
 * Replace in-memory `store.logs` with `GET /api/logs` (PostgreSQL TaskLog rows).
 * Call after `loadBackendStore()` on workflow pages: when company-store snapshots
 * are not written (`NEXT_PUBLIC_SERVER_DATABASE_ONLY`), snapshot `logs` are stale
 * and task history would otherwise stay empty.
 */
export async function hydrateTaskLogsFromApi() {
  try {
    const rows = await getLogs();
    (store as any).logs = Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.error("[TASK_LOGS] Could not hydrate logs from API:", e);
  }
}

export async function saveBackendStore() {
  if (!shouldWriteCompanyStoreSnapshot()) {
    return { ok: true, skippedCompanyStoreSnapshot: true as const };
  }
  const snapshot = getStoreSnapshot();

  return apiRequest("/api/store", {
    method: "PUT",
    body: snapshot,
  });
}