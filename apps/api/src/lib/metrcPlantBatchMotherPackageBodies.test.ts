import { describe, expect, it } from "vitest";
import { buildMetrcMotherPlantPackageBody } from "./metrcPlantBatchMotherPackageBodies.js";

describe("buildMetrcMotherPlantPackageBody", () => {
  it("builds METRC frommotherplant payload with null Id and source plant label as PlantBatch", () => {
    const body = buildMetrcMotherPlantPackageBody({
      sourcePlantLabel: "AAA00080000196B000000007",
      packageTag: "AAA00090000196B000000017",
      count: 3,
      actualDate: "2026-05-28",
      locationName: "SBX Default Location Type Location 1",
      itemName: "SBX Immature Plants SBX Strain 1 Item",
    });

    expect(body).toEqual([
      {
        Id: null,
        PlantBatch: "AAA00080000196B000000007",
        Count: 3,
        Tag: "AAA00090000196B000000017",
        Location: "SBX Default Location Type Location 1",
        Sublocation: null,
        Item: "SBX Immature Plants SBX Strain 1 Item",
        PatientLicenseNumber: null,
        Note: "NexBatch sandbox evaluation - package from mother plant.",
        IsTradeSample: false,
        IsDonation: false,
        ActualDate: "2026-05-28",
      },
    ]);
  });
});
