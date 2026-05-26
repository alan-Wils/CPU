import { parseMetrcDataRecords } from "./metrcConnectionHelpers.js";

export type ParsedMetrcPlantBatch = {
  metrcPlantBatchId: string;
  name: string;
  strainName: string;
  metrcStrainId: string | null;
  count: number;
  metrcLocationId: string;
  locationName: string;
  plantedDate: Date | null;
  lastModified: Date | null;
  active: boolean;
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

function readNumberField(row: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const raw = row[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const n = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function readDateField(row: Record<string, unknown>, keys: string[]): Date | null {
  for (const key of keys) {
    const raw = row[key];
    if (raw === undefined || raw === null || raw === "") continue;
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
    const parsed = new Date(String(raw).trim());
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function readPlantBatchId(row: Record<string, unknown>): string {
  const raw = row.Id ?? row.id ?? row.PlantBatchId ?? row.plantBatchId;
  if (raw === undefined || raw === null) return "";
  return String(raw).trim();
}

function readCount(row: Record<string, unknown>): number {
  const tracked = readNumberField(row, [
    "TrackedCount",
    "trackedCount",
    "ImmatureCount",
    "immatureCount",
    "Count",
    "count",
  ]);
  if (tracked > 0) return tracked;
  const untracked = readNumberField(row, ["UntrackedCount", "untrackedCount"]);
  return tracked + untracked;
}

function readLocationFields(row: Record<string, unknown>): {
  metrcLocationId: string;
  locationName: string;
} {
  const location = row.Location ?? row.location;
  if (location && typeof location === "object" && !Array.isArray(location)) {
    const loc = location as Record<string, unknown>;
    return {
      metrcLocationId: readStringField(loc, ["Id", "id", "LocationId", "locationId"]),
      locationName: readStringField(loc, ["Name", "name"]),
    };
  }
  return {
    metrcLocationId: readStringField(row, ["LocationId", "locationId", "RoomId", "roomId"]),
    locationName: readStringField(row, ["LocationName", "locationName", "Location", "location"]),
  };
}

function readStrainFields(row: Record<string, unknown>): {
  strainName: string;
  metrcStrainId: string | null;
} {
  const strain = row.Strain ?? row.strain;
  if (strain && typeof strain === "object" && !Array.isArray(strain)) {
    const s = strain as Record<string, unknown>;
    const id = readStringField(s, ["Id", "id", "StrainId", "strainId"]);
    return {
      strainName: readStringField(s, ["Name", "name"]),
      metrcStrainId: id || null,
    };
  }
  const id = readStringField(row, ["StrainId", "strainId"]);
  return {
    strainName: readStringField(row, ["StrainName", "strainName", "Strain", "strain"]),
    metrcStrainId: id || null,
  };
}

function mergeParsed(prev: ParsedMetrcPlantBatch | undefined, next: ParsedMetrcPlantBatch): ParsedMetrcPlantBatch {
  if (!prev) return next;
  return {
    metrcPlantBatchId: next.metrcPlantBatchId || prev.metrcPlantBatchId,
    name: next.name || prev.name,
    strainName: next.strainName || prev.strainName,
    metrcStrainId: next.metrcStrainId ?? prev.metrcStrainId,
    count: next.count > 0 ? next.count : prev.count,
    metrcLocationId: next.metrcLocationId || prev.metrcLocationId,
    locationName: next.locationName || prev.locationName,
    plantedDate: next.plantedDate ?? prev.plantedDate,
    lastModified: next.lastModified ?? prev.lastModified,
    active: next.active,
    raw: next.raw,
  };
}

export function parseMetrcPlantBatchesPayload(body: unknown): ParsedMetrcPlantBatch[] {
  const records = parseMetrcDataRecords(body);
  const byId = new Map<string, ParsedMetrcPlantBatch>();

  for (const row of records) {
    const metrcPlantBatchId = readPlantBatchId(row);
    if (!metrcPlantBatchId) continue;
    const { strainName, metrcStrainId } = readStrainFields(row);
    const { metrcLocationId, locationName } = readLocationFields(row);
    const parsed: ParsedMetrcPlantBatch = {
      metrcPlantBatchId,
      name: readStringField(row, ["Name", "name"]),
      strainName,
      metrcStrainId,
      count: readCount(row),
      metrcLocationId,
      locationName,
      plantedDate: readDateField(row, [
        "PlantedDate",
        "plantedDate",
        "PlantingDate",
        "plantingDate",
        "ActualDate",
        "actualDate",
      ]),
      lastModified: readDateField(row, ["LastModified", "lastModified"]),
      active: true,
      raw: row,
    };
    byId.set(metrcPlantBatchId, mergeParsed(byId.get(metrcPlantBatchId), parsed));
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
