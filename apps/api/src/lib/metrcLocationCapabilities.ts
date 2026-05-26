import {
  findMetrcLocationById,
  findMetrcLocationByName,
  listMetrcHarvestCapableLocations,
  listMetrcPlantCapableLocations,
} from "../repositories/metrcLocationRepository.js";

/** Preferred sandbox default when synced from METRC. */
export const METRC_DEFAULT_PLANT_GROWTH_LOCATION_NAME = "SBX Default Location Type Location 1";

export type MetrcLocationRef = {
  metrcLocationId: string;
  name: string;
  forPlants: boolean;
  forHarvests: boolean;
};

export function pickDefaultPlantGrowthLocation(
  locations: MetrcLocationRef[],
): MetrcLocationRef | null {
  const plantCapable = locations.filter((l) => l.forPlants);
  if (!plantCapable.length) return null;
  const preferred = plantCapable.find(
    (l) =>
      l.name.trim().toLowerCase() === METRC_DEFAULT_PLANT_GROWTH_LOCATION_NAME.toLowerCase(),
  );
  return preferred ?? plantCapable[0] ?? null;
}

export function pickDefaultHarvestDryingLocation(
  locations: MetrcLocationRef[],
): MetrcLocationRef | null {
  const harvestCapable = locations.filter((l) => l.forHarvests);
  if (!harvestCapable.length) return null;
  return harvestCapable[0] ?? null;
}

export async function listPlantCapableMetrcLocations(
  companyId: string,
): Promise<MetrcLocationRef[]> {
  const rows = await listMetrcPlantCapableLocations(companyId);
  return rows.map((r) => ({
    metrcLocationId: r.metrcLocationId,
    name: r.name,
    forPlants: r.forPlants,
    forHarvests: r.forHarvests,
  }));
}

export async function listHarvestCapableMetrcLocations(
  companyId: string,
): Promise<MetrcLocationRef[]> {
  const rows = await listMetrcHarvestCapableLocations(companyId);
  return rows.map((r) => ({
    metrcLocationId: r.metrcLocationId,
    name: r.name,
    forPlants: r.forPlants,
    forHarvests: r.forHarvests,
  }));
}

export type ResolveMetrcLocationResult =
  | { ok: true; location: MetrcLocationRef }
  | { ok: false; status: number; message: string };

export async function resolvePlantGrowthLocation(input: {
  companyId: string;
  metrcLocationId?: string | null;
  locationName?: string | null;
}): Promise<ResolveMetrcLocationResult> {
  const id = String(input.metrcLocationId || "").trim();
  const name = String(input.locationName || "").trim();

  let row = null;
  if (id) {
    row = await findMetrcLocationById(input.companyId, id);
  } else if (name) {
    row = await findMetrcLocationByName(input.companyId, name);
  }

  if (!row) {
    return {
      ok: false,
      status: 400,
      message: "Plant growth location not found. Sync METRC locations first.",
    };
  }

  if (!row.forPlants) {
    return {
      ok: false,
      status: 400,
      message: `Location "${row.name}" is not plant-capable (ForPlants must be true for growth phase).`,
    };
  }

  return {
    ok: true,
    location: {
      metrcLocationId: row.metrcLocationId,
      name: row.name,
      forPlants: row.forPlants,
      forHarvests: row.forHarvests,
    },
  };
}

export async function resolveHarvestDryingLocation(input: {
  companyId: string;
  metrcLocationId?: string | null;
  locationName?: string | null;
}): Promise<ResolveMetrcLocationResult> {
  const id = String(input.metrcLocationId || "").trim();
  const name = String(input.locationName || "").trim();

  let row = null;
  if (id) {
    row = await findMetrcLocationById(input.companyId, id);
  } else if (name) {
    row = await findMetrcLocationByName(input.companyId, name);
  }

  if (!row) {
    return {
      ok: false,
      status: 400,
      message: "Harvest drying location not found. Sync METRC locations first.",
    };
  }

  if (!row.forHarvests) {
    return {
      ok: false,
      status: 400,
      message: `Location "${row.name}" is not harvest-capable (ForHarvests must be true for drying).`,
    };
  }

  return {
    ok: true,
    location: {
      metrcLocationId: row.metrcLocationId,
      name: row.name,
      forPlants: row.forPlants,
      forHarvests: row.forHarvests,
    },
  };
}
