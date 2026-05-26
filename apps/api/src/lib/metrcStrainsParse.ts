import { parseMetrcDataRecords } from "./metrcConnectionHelpers.js";

export type ParsedMetrcStrain = {
  metrcStrainId: string;
  name: string;
  testingStatus: string;
  active: boolean;
  archived: boolean;
  lastModified: Date | null;
  raw: Record<string, unknown>;
};

function readMetrcStrainId(row: Record<string, unknown>): string {
  const raw = row.Id ?? row.id ?? row.StrainId ?? row.strainId;
  if (raw === undefined || raw === null) return "";
  return String(raw).trim();
}

function readBooleanField(row: Record<string, unknown>, keys: string[], defaultValue = false): boolean {
  for (const key of keys) {
    const raw = row[key];
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "string") {
      const s = raw.trim().toLowerCase();
      if (s === "true" || s === "1" || s === "yes") return true;
      if (s === "false" || s === "0" || s === "no") return false;
    }
    if (typeof raw === "number") return raw !== 0;
  }
  return defaultValue;
}

function readLastModified(row: Record<string, unknown>): Date | null {
  const raw =
    row.LastModified ??
    row.lastModified ??
    row.LastModifiedDate ??
    row.lastModifiedDate ??
    row.ModifiedDate ??
    row.modifiedDate;
  if (raw === undefined || raw === null || raw === "") return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  const parsed = new Date(String(raw).trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseMetrcStrainsPayload(body: unknown): ParsedMetrcStrain[] {
  const byId = new Map<string, ParsedMetrcStrain>();
  for (const row of parseMetrcDataRecords(body)) {
    const metrcStrainId = readMetrcStrainId(row);
    if (!metrcStrainId) continue;
    byId.set(metrcStrainId, {
      metrcStrainId,
      name: String(row.Name ?? row.name ?? "").trim(),
      testingStatus: String(
        row.TestingStatus ?? row.testingStatus ?? row.TestStatus ?? row.testStatus ?? "",
      ).trim(),
      active: readBooleanField(row, ["IsActive", "isActive", "Active", "active"], true),
      archived: readBooleanField(row, ["IsArchived", "isArchived", "Archived", "archived"], false),
      lastModified: readLastModified(row),
      raw: row,
    });
  }
  return [...byId.values()];
}
