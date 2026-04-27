import { store } from "./store";
import { apiGet } from "./api";

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

function isExtractionInputType(row: any) {
  const t = String(row?.type || row?.materialType || "").toLowerCase();
  const n = String(row?.name || "").toLowerCase();
  return t.includes("fresh frozen") || t.includes("dry trim") || n.includes("fresh frozen") || n.includes("dry trim");
}

function normalizeAmountToLbs(amount: any) {
  const text = String(amount ?? "").toLowerCase();
  const gramsMatch = text.match(/(\d+(\.\d+)?)\s*grams?/);
  if (gramsMatch) {
    const grams = Number(gramsMatch[1]);
    return Number.isFinite(grams) ? grams / 453.592 : 0;
  }
  const lbsMatch = text.match(/(\d+(\.\d+)?)\s*lbs?/);
  if (lbsMatch) {
    const lbs = Number(lbsMatch[1]);
    return Number.isFinite(lbs) ? lbs : 0;
  }
  const numeric = Number(String(amount ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

export async function createSourceBatch(batch: any) {
  const linkedCultivation =
    (store.cultivationBatches || []).find((b: any) => b.id === batch?.source || b.dbId === batch?.source) ||
    (store.completedCultivationBatches || []).find((b: any) => b.id === batch?.source || b.dbId === batch?.source) ||
    null;
  const enriched = {
    ...batch,
    cultivationBatchId: batch?.cultivationBatchId || linkedCultivation?.dbId || linkedCultivation?.id || undefined
  };
  const existing = (store.sourceBatches || []).find(
    (row: any) => normalizeId(row?.id) === normalizeId(enriched?.id)
  );
  if (existing) Object.assign(existing, enriched);
  else store.sourceBatches = uniqueById([enriched, ...(store.sourceBatches || [])]);
  store.save?.();
  return enriched;
}

export async function loadSourceBatches() {
  try {
    const token = localStorage.getItem("token");
    const [active, dataHub] = await Promise.all([
      apiGet<any>("/workflow/active", token).catch(() => ({})),
      apiGet<any>("/data-hub", token).catch(() => ({ batches: [] }))
    ]);
    const sourceMaterial = Array.isArray(active?.sourceMaterial) ? active.sourceMaterial : [];
    const batches = Array.isArray(dataHub?.batches) ? dataHub.batches : [];
    const byBatch = new Map<string, any>(batches.map((b: any) => [String(b.id), b]));
    const mapped = sourceMaterial.flatMap((row: any) => {
      const batch = byBatch.get(String(row?.batchId || ""));
      if (!batch) return [];
      const trimTotal = Number(batch?.trimDispatched?.total || 0);
      const trimToExtraction = Number(batch?.trimDispatched?.toExtraction || 0);
      const trimConsumed = Number(batch?.trimDispatched?.consumed || 0);
      const trimRemainingGrams = Math.max(trimTotal - trimToExtraction - trimConsumed, 0);
      const freshTotal = Number(batch?.freshFrozenTotal || 0);
      const freshToExtraction = Number(batch?.freshFrozenToExtraction || 0);
      const freshRemainingGrams = Math.max(freshTotal - freshToExtraction, 0);
      const toLbs = (g: number) => +(g / 453.592).toFixed(2);
      const out: any[] = [];
      if (freshRemainingGrams > 0) {
        out.push({
          id: `FF-${row.batchId}`,
          name: `${row.strain} Fresh Frozen`,
          type: "Fresh Frozen",
          source: row.batchId,
          cultivationBatchId: row.batchId,
          amount: `${toLbs(freshTotal)} lbs`,
          remainingAmount: toLbs(freshRemainingGrams),
          status: freshRemainingGrams > 0 ? "Available for Extraction" : "Used in Extraction"
        });
      }
      if (trimRemainingGrams > 0) {
        out.push({
          id: `TRIM-${row.batchId}`,
          name: `${row.strain} Dry Trim`,
          type: "Dry Trim",
          source: row.batchId,
          cultivationBatchId: row.batchId,
          amount: `${toLbs(trimTotal)} lbs`,
          remainingAmount: toLbs(trimRemainingGrams),
          status: trimRemainingGrams > 0 ? "Available for Extraction" : "Used in Extraction"
        });
      }
      return out;
    });
    const local = Array.isArray(store.sourceBatches) ? store.sourceBatches : [];
    const merged = uniqueById([...local, ...mapped]).map((row: any) => {
      const amountLbs =
        row?.amount !== undefined ? normalizeAmountToLbs(row.amount) : Number(row?.remainingAmount || 0);
      const remainingRaw =
        row?.remainingAmount !== undefined ? Number(row.remainingAmount) : amountLbs;
      const remaining = Number.isFinite(remainingRaw)
        ? amountLbs > 0
          ? Math.min(Math.max(remainingRaw, 0), amountLbs)
          : Math.max(remainingRaw, 0)
        : amountLbs;
      return {
        ...row,
        amount:
          row?.amount !== undefined && row?.amount !== null && String(row.amount).trim().length > 0
            ? row.amount
            : `${amountLbs.toFixed(2)} lbs`,
        remainingAmount: Number.isFinite(remaining) ? Number(remaining.toFixed(2)) : 0
      };
    })
      .filter(isExtractionInputType)
      .filter((row: any) => Number(row?.remainingAmount || 0) > 0)
      .filter((row: any) => !String(row?.status || "").toLowerCase().includes("used in extraction"));
    store.sourceBatches = merged;
    return merged;
  } catch {
    return uniqueById((store.sourceBatches || []).filter(isExtractionInputType));
  }
}

export async function updateSourceBatch(batchId: string, patch: any) {
  store.sourceBatches = (store.sourceBatches || []).map((row: any) =>
    row?.id === batchId ? { ...row, ...patch } : row
  );
  store.sourceBatches = uniqueById(store.sourceBatches || []);
  store.save?.();
  return patch;
}

export async function deleteSourceBatchRecord(batchId: string) {
  store.sourceBatches = (store.sourceBatches || []).filter((row: any) => row?.id !== batchId);
  store.save?.();
  return { ok: true };
}
