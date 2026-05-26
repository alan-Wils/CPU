import { parseMetrcDataRecords } from "./metrcConnectionHelpers.js";

export type ParsedMetrcLocation = {
  metrcLocationId: string;
  name: string;
  locationTypeId: number | null;
  locationTypeName: string;
  forPlants: boolean;
  forHarvests: boolean;
  forPackages: boolean;
  raw: Record<string, unknown>;
};

function readMetrcLocationId(row: Record<string, unknown>): string {
  const raw = row.Id ?? row.id ?? row.LocationId ?? row.locationId;
  if (raw === undefined || raw === null) return "";
  return String(raw).trim();
}

function readBooleanField(row: Record<string, unknown>, keys: string[]): boolean {
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
  return false;
}

function readLocationTypeId(row: Record<string, unknown>): number | null {
  const raw = row.LocationTypeId ?? row.locationTypeId;
  if (raw === undefined || raw === null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function parseMetrcLocationsPayload(body: unknown): ParsedMetrcLocation[] {
  const out: ParsedMetrcLocation[] = [];
  for (const row of parseMetrcDataRecords(body)) {
    const metrcLocationId = readMetrcLocationId(row);
    if (!metrcLocationId) continue;
    out.push({
      metrcLocationId,
      name: String(row.Name ?? row.name ?? "").trim(),
      locationTypeId: readLocationTypeId(row),
      locationTypeName: String(
        row.LocationTypeName ?? row.locationTypeName ?? row.LocationType ?? row.locationType ?? "",
      ).trim(),
      forPlants: readBooleanField(row, [
        "ForPlants",
        "forPlants",
        "ForPlantVegetation",
        "forPlantVegetation",
        "ForPlant",
        "forPlant",
      ]),
      forHarvests: readBooleanField(row, ["ForHarvests", "forHarvests", "ForHarvest", "forHarvest"]),
      forPackages: readBooleanField(row, ["ForPackages", "forPackages", "ForPackage", "forPackage"]),
      raw: row,
    });
  }
  return out;
}
