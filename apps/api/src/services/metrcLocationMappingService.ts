import {
  findNexbatchRoomOption,
  formatNexbatchRoomLabel,
  parseNexbatchRoomOptionsFromCompanyValue,
  type NexbatchRoomOption,
  type NexbatchRoomSuite,
} from "../lib/metrcNexbatchRooms.js";
import { listMetrcLocationsForCompany } from "../repositories/metrcLocationRepository.js";
import { ConfigService } from "./configService.js";

export type MetrcLocationRoomMapping = {
  metrcLocationId: string;
  metrcLocationName: string;
  licenseNumber: string;
  forPlants: boolean;
  forHarvests: boolean;
  forPackages: boolean;
  nexbatchRoomSuite: NexbatchRoomSuite | null;
  nexbatchRoomId: string | null;
  nexbatchRoomLabel: string | null;
  mappingSource: "manual" | "auto" | "none";
  nexbatchMappingManual: boolean;
};

function resolveMappingSource(row: {
  nexbatchRoomId: string | null;
  nexbatchMappingManual: boolean;
}): MetrcLocationRoomMapping["mappingSource"] {
  if (!row.nexbatchRoomId) return "none";
  return row.nexbatchMappingManual ? "manual" : "auto";
}

function rowToMapping(
  row: Awaited<ReturnType<typeof listMetrcLocationsForCompany>>[number],
  nexbatchRooms: NexbatchRoomOption[],
): MetrcLocationRoomMapping {
  const suite =
    row.nexbatchRoomSuite === "vegRooms" ||
    row.nexbatchRoomSuite === "flowerRooms" ||
    row.nexbatchRoomSuite === "dryRooms" ||
    row.nexbatchRoomSuite === "freezers"
      ? row.nexbatchRoomSuite
      : null;
  const matched = findNexbatchRoomOption(nexbatchRooms, suite, row.nexbatchRoomId);
  return {
    metrcLocationId: row.metrcLocationId,
    metrcLocationName: row.name,
    licenseNumber: row.licenseNumber,
    forPlants: row.forPlants,
    forHarvests: row.forHarvests,
    forPackages: row.forPackages,
    nexbatchRoomSuite: suite,
    nexbatchRoomId: row.nexbatchRoomId,
    nexbatchRoomLabel: matched ? formatNexbatchRoomLabel(matched) : null,
    mappingSource: resolveMappingSource(row),
    nexbatchMappingManual: row.nexbatchMappingManual,
  };
}

export class MetrcLocationMappingService {
  configService = new ConfigService();

  async loadNexbatchRoomOptions(companyId: string): Promise<NexbatchRoomOption[]> {
    const rows = await this.configService.list(companyId);
    const companyRow = rows.find((r) => r.key === "company");
    if (!companyRow?.value || typeof companyRow.value !== "object") return [];
    return parseNexbatchRoomOptionsFromCompanyValue(companyRow.value as Record<string, unknown>);
  }

  async listLocationRoomMappings(companyId: string): Promise<MetrcLocationRoomMapping[]> {
    const nexbatchRooms = await this.loadNexbatchRoomOptions(companyId);
    const rows = await listMetrcLocationsForCompany(companyId);
    return rows.map((row) => rowToMapping(row, nexbatchRooms));
  }

  async resolveLocationRoomMapping(
    companyId: string,
    metrcLocationId: string,
  ): Promise<MetrcLocationRoomMapping | null> {
    const nexbatchRooms = await this.loadNexbatchRoomOptions(companyId);
    const rows = await listMetrcLocationsForCompany(companyId);
    const row = rows.find((r) => r.metrcLocationId === metrcLocationId);
    if (!row) return null;
    return rowToMapping(row, nexbatchRooms);
  }
}

export async function listMetrcLocationRoomMappings(
  companyId: string,
): Promise<MetrcLocationRoomMapping[]> {
  return new MetrcLocationMappingService().listLocationRoomMappings(companyId);
}

export async function resolveMetrcLocationRoomMapping(
  companyId: string,
  metrcLocationId: string,
): Promise<MetrcLocationRoomMapping | null> {
  return new MetrcLocationMappingService().resolveLocationRoomMapping(companyId, metrcLocationId);
}
