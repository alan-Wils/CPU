import { describe, expect, it } from "vitest";
import { buildMetrcMotherPlantPackageBody } from "./metrcPlantBatchMotherPackageBodies.js";

describe("buildMetrcMotherPlantPackageBody", () => {
  it("builds METRC frommotherplant payload with plant Id and null PlantBatch", () => {
    const body = buildMetrcMotherPlantPackageBody({
      metrcPlantId: 42,
      packageTag: "BLUE.27.26",
      count: 3,
      actualDate: "2026-05-27",
      locationName: "SBX Default Location Type Location 1",
      itemName: "SBX Bud allocated for extraction SBX Strain 1 Item",
    });

    expect(body).toEqual([
      {
        Id: 42,
        PlantBatch: null,
        Count: 3,
        Tag: "BLUE.27.26",
        Location: "SBX Default Location Type Location 1",
        Item: "SBX Bud allocated for extraction SBX Strain 1 Item",
        PatientLicenseNumber: null,
        Note: "NexBatch sandbox evaluation - package from mother plant.",
        IsTradeSample: false,
        IsDonation: false,
        ActualDate: "2026-05-27",
      },
    ]);
  });
});
