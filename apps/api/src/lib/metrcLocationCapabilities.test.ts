import { describe, expect, it } from "vitest";
import {
  METRC_DEFAULT_PLANT_GROWTH_LOCATION_NAME,
  pickDefaultHarvestDryingLocation,
  pickDefaultPlantGrowthLocation,
} from "./metrcLocationCapabilities.js";

describe("metrcLocationCapabilities", () => {
  it("prefers SBX Default Location Type Location 1 for plant growth", () => {
    const picked = pickDefaultPlantGrowthLocation([
      {
        metrcLocationId: "1",
        name: "SBX Centralized Processing Hub Location 1",
        forPlants: false,
        forHarvests: true,
      },
      {
        metrcLocationId: "2",
        name: METRC_DEFAULT_PLANT_GROWTH_LOCATION_NAME,
        forPlants: true,
        forHarvests: false,
      },
    ]);
    expect(picked?.name).toBe(METRC_DEFAULT_PLANT_GROWTH_LOCATION_NAME);
    expect(picked?.forPlants).toBe(true);
  });

  it("picks first harvest-capable location for drying", () => {
    const picked = pickDefaultHarvestDryingLocation([
      {
        metrcLocationId: "1",
        name: "Dry Room",
        forPlants: false,
        forHarvests: true,
      },
    ]);
    expect(picked?.name).toBe("Dry Room");
  });
});
