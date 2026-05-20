/**
 * Lightweight source-batch list rows (detail via GET /api/source-batches/:id).
 */

const SUMMARY_KEYS = [
    "id",
    "name",
    "type",
    "source",
    "strain",
    "status",
    "amount",
    "grams",
    "bundles",
    "weightLbs",
] as const;

function capStr(value: unknown, max = 120): string {
  const s = String(value ?? "").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

export type SourceBatchListRow = Record<(typeof SUMMARY_KEYS)[number], string | number>;

export function prismaSourcePackageToListRow(p: {
  id: string;
  canonicalName: string;
  role: string;
  sourceChain: {
    cultivationBatchId: string;
    cultivationBatch: { strain: string } | null;
  };
}): SourceBatchListRow {
  const typeMap: Record<string, string> = {
    A_GRADE_FLOWER: "A Grade Flower",
    POPCORN: "Popcorn",
    DRY_TRIM: "Dry Trim",
    FRESH_FROZEN: "Fresh Frozen",
  };
  return {
    id: p.id,
    name: capStr(p.canonicalName),
    type: typeMap[p.role] || p.role,
    source: p.sourceChain.cultivationBatchId,
    strain: capStr(p.sourceChain.cultivationBatch?.strain ?? ""),
    status: "Available for Extraction",
    amount: "",
    grams: 0,
    bundles: 0,
    weightLbs: 0,
  };
}

export function storeSourceBatchToListRow(row: unknown): SourceBatchListRow | null {
  const r = row && typeof row === "object" ? (row as Record<string, unknown>) : null;
  if (!r) return null;
  const id = String(r.id || "").trim();
  if (!id) return null;
  return {
    id,
    name: capStr(r.name ?? r.id),
    type: capStr(r.type),
    source: capStr(r.source),
    strain: capStr(r.strain),
    status: capStr(r.status),
    amount: r.amount !== undefined && r.amount !== null ? capStr(r.amount, 60) : "",
    grams: Number.isFinite(Number(r.grams)) ? Number(r.grams) : 0,
    bundles: Number.isFinite(Number(r.bundles)) ? Math.trunc(Number(r.bundles)) : 0,
    weightLbs: Number.isFinite(Number(r.weightLbs)) ? Number(r.weightLbs) : 0,
  };
}
