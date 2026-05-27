import { parseMetrcDataRecords } from "./metrcConnectionHelpers.js";

export type ParsedMetrcPackageAdjustmentReason = {
  name: string;
  requiresNote: boolean;
  raw: Record<string, unknown>;
};

function readStringField(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const raw = row[key];
    if (raw === undefined || raw === null) continue;
    const s = String(raw).trim();
    if (s) return s;
  }
  return "";
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

export function parseMetrcPackageAdjustmentReasonsPayload(
  bodyJson: unknown,
): ParsedMetrcPackageAdjustmentReason[] {
  const rows = parseMetrcDataRecords(bodyJson);
  const out: ParsedMetrcPackageAdjustmentReason[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const name = readStringField(row, ["Name", "name", "AdjustmentReason", "adjustmentReason"]);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      requiresNote: readBooleanField(row, ["RequiresNote", "requiresNote"], false),
      raw: row,
    });
  }

  return out;
}

export function isActivePackageAdjustmentReason(reason: ParsedMetrcPackageAdjustmentReason): boolean {
  const row = reason.raw;
  if (readBooleanField(row, ["IsArchived", "isArchived", "Archived", "archived"], false)) {
    return false;
  }
  if (readBooleanField(row, ["IsActive", "isActive", "Active", "active"], true) === false) {
    return false;
  }
  return Boolean(reason.name.trim());
}

export function pickFirstActivePackageAdjustmentReason(
  reasons: ParsedMetrcPackageAdjustmentReason[],
): ParsedMetrcPackageAdjustmentReason | null {
  return reasons.find(isActivePackageAdjustmentReason) ?? null;
}

/** Prefer Entry Error when METRC lists it for package adjustments (sandbox evaluation). */
export function pickEvaluationPackageAdjustmentReason(
  reasons: ParsedMetrcPackageAdjustmentReason[],
): ParsedMetrcPackageAdjustmentReason | null {
  const active = reasons.filter(isActivePackageAdjustmentReason);
  const entryError = active.find((reason) => reason.name === "Entry Error");
  if (entryError) return entryError;
  return active[0] ?? null;
}
