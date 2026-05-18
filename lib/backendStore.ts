import { apiRequest, getLogs, getSelectedCompanyId } from "@/lib/api";
import { store } from "@/lib/store";
import { CPU_TENANT_CHANGED_EVENT } from "@/lib/tenantEvents";
import {
  copyDryFlowerBatchesIntoProduction,
  hydrateDryFlowerBatchesFromLogSnapshots,
} from "./dryFlowerLogHydrate";

export { snapshotDryFlowerCardFields } from "./dryFlowerLogHydrate";
const locallyDeletedDryFlowerBatchIds = new Set<string>();

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

/**
 * Merge server dry-flower rows with the previous in-memory list so local workflow fields
 * (buck/trim/decon/testing) win over a stale snapshot. Necessary when `PUT /api/store` is skipped
 * (DATABASE_ONLY), and also when snapshots lag briefly behind in-session edits after a PUT.
 */
export function mergeDryFlowerBatchesWithLocalSnapshot(snapRows: unknown[], localRows: unknown[]): unknown[] {
  const byId = new Map<string, any>();
  for (const s of Array.isArray(snapRows) ? snapRows : []) {
    const row = s as any;
    const id = String(row?.id || "");
    if (id) byId.set(id, { ...row });
  }
  for (const loc of Array.isArray(localRows) ? localRows : []) {
    const row = loc as any;
    const id = String(row?.id || "");
    if (!id) continue;
    const prev = byId.get(id) || {};
    byId.set(id, { ...prev, ...row });
  }
  return [...byId.values()];
}

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

function removeLocallyDeletedDryRows() {
  if (locallyDeletedDryFlowerBatchIds.size === 0) return;
  (store as any).dryFlowerBatches = ((store as any).dryFlowerBatches || []).filter((row: any) => {
    const id = String(row?.id || "");
    return !id || !locallyDeletedDryFlowerBatchIds.has(id);
  });
  (store as any).productionBatches = ((store as any).productionBatches || []).filter((row: any) => {
    const id = String(row?.id || "");
    return !id || !locallyDeletedDryFlowerBatchIds.has(id);
  });
}

export function markDryFlowerBatchDeleted(batchId: string) {
  const id = String(batchId || "").trim();
  if (!id) return;
  locallyDeletedDryFlowerBatchIds.add(id);
}

export type LoadBackendStoreOptions = ApplyStoreSnapshotOptions & {
  /**
   * When true, calls `GET /api/store/version` first and skips downloading the full company JSON
   * if the server `updatedAt` matches the last successful load for this tenant (big Neon + bandwidth win).
   */
  skipFullStoreIfUnchanged?: boolean;
};

const lastStoreUpdatedAtByCompany = new Map<string, string | null>();

if (typeof window !== "undefined") {
  window.addEventListener(CPU_TENANT_CHANGED_EVENT, () => {
    lastStoreUpdatedAtByCompany.clear();
  });
}

function rememberStoreVersion(companyId: string, updatedAt: string | null | undefined) {
  const id = String(companyId || "").trim();
  if (!id) return;
  if (updatedAt === undefined) return;
  lastStoreUpdatedAtByCompany.set(id, updatedAt ?? null);
}

/** `@cpu/api` exposes `/api/store` (legacy Node backend used `/api/sync`). */
export async function loadBackendStore(options?: LoadBackendStoreOptions) {
  const companyId = typeof window !== "undefined" ? getSelectedCompanyId().trim() : "";

  if (options?.skipFullStoreIfUnchanged && companyId) {
    try {
      const version = await apiRequest<{ updatedAt: string | null }>("/api/store/version", {
        companyId,
      });
      const last = lastStoreUpdatedAtByCompany.get(companyId);
      if (last && version?.updatedAt === last) {
        return null;
      }
    } catch {
      /* continue with full load */
    }
  }

  const snapshot = await apiRequest("/api/store", companyId ? { companyId } : {});
  const meta = (snapshot as { _meta?: { updatedAt?: string | null } })?._meta;
  rememberStoreVersion(companyId, meta?.updatedAt ?? null);

  const prevDry = [...((store as any).dryFlowerBatches || [])];
  applyStoreSnapshot(snapshot, options);
  removeLocallyDeletedDryRows();
  (store as any).dryFlowerBatches = mergeDryFlowerBatchesWithLocalSnapshot(
    (store as any).dryFlowerBatches,
    prevDry,
  );
  removeLocallyDeletedDryRows();
  copyDryFlowerBatchesIntoProduction(store);
  return snapshot;
}

/**
 * Replace in-memory `store.logs` with `GET /api/logs` (PostgreSQL TaskLog rows).
 * Call after `loadBackendStore()` on workflow pages: when company-store snapshots
 * are not written (`NEXT_PUBLIC_SERVER_DATABASE_ONLY`), snapshot `logs` are stale
 * and task history would otherwise stay empty.
 */
export async function hydrateTaskLogsFromApi(opts?: { take?: number }) {
  try {
    const raw = await getLogs(undefined, { take: opts?.take ?? 50, compact: true });
    const rows = Array.isArray(raw) ? raw : (raw as { items?: unknown[] })?.items ?? [];
    (store as any).logs = Array.isArray(rows) ? rows : [];
    hydrateDryFlowerBatchesFromLogSnapshots(store, locallyDeletedDryFlowerBatchIds);
  } catch (e) {
    console.error("[TASK_LOGS] Could not hydrate logs from API:", e);
  }
}

export async function saveBackendStore() {
  if (!shouldWriteCompanyStoreSnapshot()) {
    return { ok: true, skippedCompanyStoreSnapshot: true as const };
  }
  const snapshot = getStoreSnapshot();

  const result = await apiRequest("/api/store", {
    method: "PUT",
    body: snapshot,
  });
  const cid = typeof window !== "undefined" ? getSelectedCompanyId().trim() : "";
  const meta = (result as { _meta?: { updatedAt?: string | null } })?._meta;
  rememberStoreVersion(cid, meta?.updatedAt ?? null);
  return result;
}
