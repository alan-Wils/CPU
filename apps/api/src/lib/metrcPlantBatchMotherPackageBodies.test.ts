import { describe, expect, it } from "vitest";
import { buildMetrcMotherPlantPackageBody } from "./metrcPlantBatchMotherPackageBodies.js";

describe("buildMetrcMotherPlantPackageBody", () => {
  it("builds METRC frommotherplant payload with plant batch id and tag", () => {
    const body = buildMetrcMotherPlantPackageBody({
      plantBatchId: 16701,
      plantBatchName: "NexBatch Test Batch",
      packageTag: "AAA00090000196B000000001",
      count: 3,
      actualDate: "2026-05-27",
      locationName: "SBX Default Location Type Location 1",
    });

    expect(body).toEqual([
      {
        Id: 16701,
        PlantBatch: "NexBatch Test Batch",
        Count: 3,
        Location: "SBX Default Location Type Location 1",
        Sublocation: null,
        Item: "Immature Plants",
        Tag: "AAA00090000196B000000001",
        PatientLicenseNumber: null,
        Note: "NexBatch sandbox evaluation — package from mother plant batch.",
        IsTradeSample: false,
        IsDonation: false,
        ActualDate: "2026-05-27",
      },
    ]);
  });
});
