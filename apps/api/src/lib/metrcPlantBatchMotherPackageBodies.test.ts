import { describe, expect, it } from "vitest";
import { buildMetrcMotherPlantPackageBody } from "./metrcPlantBatchMotherPackageBodies.js";

describe("buildMetrcMotherPlantPackageBody", () => {
  it("builds METRC frommotherplant payload without Id using plant batch name", () => {
    const body = buildMetrcMotherPlantPackageBody({
      plantBatchName: "AAA00080000196B000009999",
      packageTag: "BLUE.27.26",
      count: 3,
      actualDate: "2026-05-27",
      locationName: "SBX Default Location Type Location 1",
      itemName: "Immature Plants",
    });

    expect(body).toEqual([
      {
        PlantBatch: "AAA00080000196B000009999",
        Count: 3,
        Tag: "BLUE.27.26",
        Location: "SBX Default Location Type Location 1",
        Item: "Immature Plants",
        PatientLicenseNumber: null,
        Note: "NexBatch sandbox evaluation - package from mother plant batch.",
        IsTradeSample: false,
        IsDonation: false,
        ActualDate: "2026-05-27",
      },
    ]);
  });
});
