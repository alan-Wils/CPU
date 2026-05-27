import { describe, expect, it } from "vitest";
import { buildMetrcPlantBatchPackageBody } from "./metrcPlantBatchPackageBodies.js";

describe("buildMetrcPlantBatchPackageBody", () => {
  it("builds METRC plant batch package payload with selected item name", () => {
    const body = buildMetrcPlantBatchPackageBody({
      plantBatchName: "AAA00080000196B000009999",
      packageTag: "AAA00090000196B000000018",
      count: 3,
      actualDate: "2026-05-27",
      locationName: "SBX Centralized Processing Hub Location 1",
      itemName: "SBX Immature Plants SBX Strain 2 Item",
    });

    expect(body).toEqual([
      {
        PlantBatch: "AAA00080000196B000009999",
        Count: 3,
        Tag: "AAA00090000196B000000018",
        Location: "SBX Centralized Processing Hub Location 1",
        Item: "SBX Immature Plants SBX Strain 2 Item",
        PatientLicenseNumber: null,
        Note: "NexBatch sandbox evaluation - plant batch package.",
        IsTradeSample: false,
        IsDonation: false,
        ActualDate: "2026-05-27",
      },
    ]);
  });

  it("uses custom note when provided", () => {
    const body = buildMetrcPlantBatchPackageBody({
      plantBatchName: "AAA00080000196B000009999",
      packageTag: "AAA00090000196B000000018",
      count: 1,
      actualDate: "2026-05-27",
      itemName: "SBX Immature Plants SBX Strain 2 Item",
      note: "Custom evaluation note.",
    });

    expect((body[0] as { Note: string }).Note).toBe("Custom evaluation note.");
  });
});
