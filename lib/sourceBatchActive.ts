/**
 * Shared rules for which source batches are "active" for extraction / production staging.
 * Mirrors the client logic used on the Extraction page.
 */

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function parseAmountToLbs(value: unknown): number {
  const text = String(value || "").toLowerCase();
  const gramsMatch = text.match(/(\d+(\.\d+)?)\s*grams?/);
  if (gramsMatch) return num(gramsMatch[1]) / 453.592;
  const lbsMatch = text.match(/(\d+(\.\d+)?)\s*lbs?/);
  if (lbsMatch) return num(lbsMatch[1]);
  return 0;
}

export function getSourceOriginalLbs(source: unknown): number {
  if (!source || typeof source !== "object") return 0;
  const s = source as Record<string, unknown>;
  if (s.weightLbs !== undefined) return num(s.weightLbs);
  if (s.grams !== undefined) return num(s.grams) / 453.592;
  if (s.amount !== undefined) return parseAmountToLbs(s.amount);
  return 0;
}

export function getSourceAvailable(source: unknown): number {
  if (!source || typeof source !== "object") return 0;
  const s = source as Record<string, unknown>;
  const original = getSourceOriginalLbs(source);

  if (s.remainingAmount !== undefined) {
    const remaining = num(s.remainingAmount);
    if (remaining <= 0 && String(s.status || "") !== "Used in Extraction") {
      return +original.toFixed(2);
    }
    return +remaining.toFixed(2);
  }

  return +original.toFixed(2);
}

export function isCompletedSourceBatch(batch: unknown): boolean {
  if (!batch || typeof batch !== "object") return false;
  const status = String((batch as { status?: unknown })?.status || "")
    .trim()
    .toLowerCase();

  if (status === "used in extraction") return true;

  if (status === "partially used in extraction") {
    return getSourceAvailable(batch) <= 0;
  }

  if (status === "complete" || status.includes("complete")) {
    // Transferred packages were sometimes saved as Complete without an extraction run.
    if (getSourceAvailable(batch) > 0) return false;
    return true;
  }

  return false;
}

/** Same predicate as Extraction's `sourceBatches` list (available material, not terminal status). */
export function isActiveExtractionSourceBatch(batch: unknown): boolean {
  return !isCompletedSourceBatch(batch) && getSourceAvailable(batch) > 0;
}
