import { parseMetrcDataRecords } from "./metrcConnectionHelpers.js";

export type ParsedMetrcHarvest = {
  metrcHarvestId: string;
  harvestName: string;
  sourcePlantBatchId: string;
  sourcePlantBatchName: string;
  strainName: string;
  metrcLocationId: string;
  locationName: string;
  harvestType: string;
  wetWeight: number;
  totalWeight: number;
  unitOfWeight: string;
  patientLicenseNumber: string;
  plantedDate: Date | null;
  finishedDate: Date | null;
  lastModified: Date | null;
  active: boolean;
  raw: Record<string, unknown>;
};

function readHarvestId(row: Record<string, unknown>): string {
  const raw = row.Id ?? row.id ?? row.HarvestId ?? row.harvestId;
  if (raw === undefined || raw === null) return "";
  return String(raw).trim();
}

function readNumber(row: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const raw = row[key];
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string" && raw.trim()) {
      const n = Number.parseFloat(raw);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

function readDate(row: Record<string, unknown>, keys: string[]): Date | null {
  for (const key of keys) {
    const raw = row[key];
    if (raw === undefined || raw === null || raw === "") continue;
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
    const parsed = new Date(String(raw).trim());
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function readPlantBatchRefs(row: Record<string, unknown>): { id: string; name: string } {
  const id = String(row.SourcePlantBatchId ?? row.sourcePlantBatchId ?? "").trim();
  const name = String(row.SourcePlantBatchName ?? row.sourcePlantBatchName ?? "").trim();
  return { id, name };
}

export function parseMetrcHarvestsPayload(body: unknown): ParsedMetrcHarvest[] {
  const byId = new Map<string, ParsedMetrcHarvest>();
  for (const row of parseMetrcDataRecords(body)) {
    const metrcHarvestId = readHarvestId(row);
    if (!metrcHarvestId) continue;

    const batchRefs = readPlantBatchRefs(row);
    const strainNames = row.SourceStrainNames ?? row.sourceStrainNames;
    let strainName = "";
    if (typeof strainNames === "string") {
      strainName = strainNames.trim();
    } else if (Array.isArray(strainNames) && strainNames.length > 0) {
      strainName = String(strainNames[0] ?? "").trim();
    }
    if (!strainName && Array.isArray(row.Strains) && row.Strains.length > 0) {
      const first = row.Strains[0];
      if (first && typeof first === "object") {
        strainName = String((first as Record<string, unknown>).Name ?? "").trim();
      }
    }

    const finishedDate = readDate(row, ["FinishedDate", "finishedDate", "ArchivedDate", "archivedDate"]);
    const active = finishedDate == null;

    byId.set(metrcHarvestId, {
      metrcHarvestId,
      harvestName: String(row.Name ?? row.name ?? "").trim(),
      sourcePlantBatchId: batchRefs.id,
      sourcePlantBatchName: batchRefs.name,
      strainName,
      metrcLocationId: String(row.DryingLocationId ?? row.dryingLocationId ?? "").trim(),
      locationName: String(row.DryingLocationName ?? row.dryingLocationName ?? "").trim(),
      harvestType: String(row.HarvestType ?? row.harvestType ?? "").trim(),
      wetWeight: readNumber(row, ["TotalWetWeight", "totalWetWeight", "WetWeight", "wetWeight"]),
      totalWeight: readNumber(row, ["CurrentWeight", "currentWeight", "TotalWeight", "totalWeight"]),
      unitOfWeight: String(row.UnitOfWeightName ?? row.unitOfWeightName ?? row.UnitOfWeight ?? "").trim(),
      patientLicenseNumber: String(row.PatientLicenseNumber ?? row.patientLicenseNumber ?? "").trim(),
      plantedDate: readDate(row, ["HarvestStartDate", "harvestStartDate", "PlantedDate", "plantedDate"]),
      finishedDate,
      lastModified: readDate(row, ["LastModified", "lastModified"]),
      active,
      raw: row,
    });
  }
  return [...byId.values()].sort((a, b) => a.harvestName.localeCompare(b.harvestName));
}
