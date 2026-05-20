import { getSourceAvailable } from "@/lib/sourceBatchActive";

function norm(value: unknown): string {
  return String(value ?? "").trim();
}

/** Cultivation → extraction transfer row (legacy store or API list). */
export function isCultivationTransferredSource(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  if (r.manualTransferToExtraction === true) return true;
  if (norm(r.cultivationTransferId)) return true;
  return false;
}

/**
 * Store snapshot sometimes marks transferred FF/trim `Complete` without an extraction run.
 * Those rows should stay available until weight is actually consumed.
 */
export function isMisclassifiedTerminalSourceBatch(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  const status = norm((row as { status?: unknown }).status).toLowerCase();
  if (status === "used in extraction") return false;
  if (!status.includes("complete")) return false;
  if (getSourceAvailable(row) <= 0) return false;
  return isCultivationTransferredSource(row);
}

export function repairMisclassifiedSourceBatchRow(row: unknown): Record<string, unknown> | null {
  if (!row || typeof row !== "object") return null;
  if (!isMisclassifiedTerminalSourceBatch(row)) return null;
  const r = { ...(row as Record<string, unknown>) };
  r.status = "Available for Extraction";
  if (r.remainingAmount !== undefined && Number(r.remainingAmount) <= 0) {
    delete r.remainingAmount;
  }
  return r;
}
