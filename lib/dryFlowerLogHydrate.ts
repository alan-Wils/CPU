/** Keep `productionBatches` rows in sync with canonical dry-flower rows (same id). */
export function copyDryFlowerBatchesIntoProduction(storeObj: any) {
  const dry = storeObj?.dryFlowerBatches;
  const prod = storeObj?.productionBatches;
  if (!Array.isArray(dry) || !Array.isArray(prod)) return;
  for (const d of dry) {
    const id = (d as any)?.id;
    if (!id) continue;
    const i = prod.findIndex((p: any) => p?.id === id);
    if (i >= 0) prod[i] = { ...prod[i], ...d };
  }
}

/**
 * Serializable dry-flower batch blob for TaskLog JSON (`data.dryFlowerCardSnapshot`).
 * Reconstructs card state when company-store JSON lags (e.g. DATABASE_ONLY).
 */
export function snapshotDryFlowerCardFields(batch: any): Record<string, unknown> | null {
  if (!batch?.id || typeof batch.id !== "string") return null;
  try {
    const raw = JSON.parse(
      JSON.stringify(batch, (_, v) => {
        if (typeof v === "function" || typeof v === "bigint") return undefined;
        return v;
      }),
    );
    if (!raw || typeof raw !== "object") return null;
    return raw as Record<string, unknown>;
  } catch {
    return null;
  }
}

function logEpochMs(log: unknown): number {
  const row = log as Record<string, unknown>;
  const raw =
    typeof row?.loggedAtIso === "string"
      ? row.loggedAtIso
      : typeof row?.loggedAt === "string"
        ? row.loggedAt
        : typeof row?.time === "string"
          ? row.time
          : "";
  const ms = typeof raw === "number" ? raw : Date.parse(String(raw));
  return Number.isFinite(ms) ? ms : 0;
}

/** Merge snapshots from cultivation logs onto `dryFlowerBatches`, chronologically (oldest first). */
export function hydrateDryFlowerBatchesFromLogSnapshots(storeObj: any) {
  const logs = storeObj?.logs;
  const batches = storeObj?.dryFlowerBatches;
  if (!Array.isArray(logs) || !Array.isArray(batches)) return;

  const withSnapshots = logs.filter((l: unknown) => {
    const row = l as Record<string, unknown>;
    const data = row?.data as Record<string, unknown> | undefined;
    const snap = data?.dryFlowerCardSnapshot;
    const id =
      snap && typeof snap === "object" && (snap as { id?: string }).id
        ? String((snap as { id?: string }).id)
        : "";
    return row?.area === "Cultivation" && Boolean(id);
  }) as Record<string, unknown>[];

  withSnapshots.sort((a, b) => logEpochMs(a) - logEpochMs(b));

  const byId = new Map<string, Record<string, unknown>>();
  for (const b of batches as unknown[]) {
    const bb = b as Record<string, unknown>;
    const id = String(bb?.id || "");
    if (!id) continue;
    byId.set(id, bb);
  }

  for (const logRow of withSnapshots) {
    const data = logRow?.data as Record<string, unknown> | undefined;
    const snapIn = data?.dryFlowerCardSnapshot as Record<string, unknown> | undefined;
    if (!snapIn || typeof snapIn !== "object") continue;

    const id = String((snapIn as { id?: string }).id || "");
    if (!id || id === "__proto__") continue;

    let row = byId.get(id);
    if (!row) {
      row = {};
      batches.push(row);
      byId.set(id, row);
    }

    for (const [k, v] of Object.entries(snapIn)) {
      if (k === "__proto__" || k === "constructor") continue;
      row[k] = v;
    }
    row.id = id;
  }

  copyDryFlowerBatchesIntoProduction(storeObj);
}
