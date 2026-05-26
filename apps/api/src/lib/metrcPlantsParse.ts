import { parseMetrcDataRecords } from "./metrcConnectionHelpers.js";

export type ParsedMetrcPlant = {
  metrcPlantId: string;
  label: string;
  sourcePlantBatchId: string;
  sourcePlantBatchName: string;
  strainName: string;
  growthPhase: string;
  metrcLocationId: string;
  locationName: string;
  plantedDate: Date | null;
  active: boolean;
  raw: Record<string, unknown>;
};

function readPlantId(row: Record<string, unknown>): string {
  const raw = row.Id ?? row.id;
  if (raw === undefined || raw === null) return "";
  return String(raw).trim();
}

function readLabel(row: Record<string, unknown>): string {
  return String(row.Label ?? row.label ?? "").trim();
}

function readDate(row: Record<string, unknown>, keys: string[]): Date | null {
  for (const key of keys) {
    const raw = row[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const parsed = new Date(String(raw).trim());
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

export function parseMetrcPlantsPayload(
  body: unknown,
  defaultGrowthPhase: string,
): ParsedMetrcPlant[] {
  const byLabel = new Map<string, ParsedMetrcPlant>();
  for (const row of parseMetrcDataRecords(body)) {
    const label = readLabel(row);
    if (!label) continue;
    const metrcPlantId = readPlantId(row) || label;
    const state = String(row.State ?? row.state ?? "").trim();
    const active = state !== "Destroyed" && state !== "Inactive";

    byLabel.set(label, {
      metrcPlantId,
      label,
      sourcePlantBatchId: String(row.PlantBatchId ?? row.plantBatchId ?? "").trim(),
      sourcePlantBatchName: String(row.PlantBatchName ?? row.plantBatchName ?? "").trim(),
      strainName: String(row.StrainName ?? row.strainName ?? "").trim(),
      growthPhase: String(row.GrowthPhase ?? row.growthPhase ?? defaultGrowthPhase).trim(),
      metrcLocationId: String(row.LocationId ?? row.locationId ?? "").trim(),
      locationName: String(row.LocationName ?? row.locationName ?? "").trim(),
      plantedDate: readDate(row, ["PlantedDate", "plantedDate", "FloweringDate", "floweringDate"]),
      active,
      raw: row,
    });
  }
  return [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label));
}
