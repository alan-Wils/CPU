/** Treat near-zero floats as empty for METRC finish eligibility. */
export const PACKAGE_QUANTITY_EMPTY_EPSILON = 1e-6;

export function isPackageQuantityEmpty(quantity: number): boolean {
  if (!Number.isFinite(quantity)) return true;
  return Math.abs(quantity) <= PACKAGE_QUANTITY_EMPTY_EPSILON;
}

function readBooleanField(row: Record<string, unknown>, keys: string[], defaultValue: boolean): boolean {
  for (const key of keys) {
    const raw = row[key];
    if (raw === undefined || raw === null) continue;
    if (typeof raw === "boolean") return raw;
    const s = String(raw).trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  return defaultValue;
}

function readStringField(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const raw = row[key];
    if (raw === undefined || raw === null) continue;
    const s = String(raw).trim();
    if (s) return s;
  }
  return "";
}

export function isPackageFinished(input: { raw?: Record<string, unknown> | null }): boolean {
  const raw = input.raw;
  if (!raw || typeof raw !== "object") return false;
  if (readBooleanField(raw, ["IsFinished", "isFinished"], false)) return true;
  const finishedDate = readStringField(raw, ["FinishedDate", "finishedDate"]);
  return Boolean(finishedDate);
}
