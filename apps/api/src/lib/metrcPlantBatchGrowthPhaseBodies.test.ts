import { describe, expect, it } from "vitest";
import { buildMetrcPlantBatchGrowthPhaseBody } from "./metrcPlantBatchGrowthPhaseBodies.js";

describe("buildMetrcPlantBatchGrowthPhaseBody", () => {
  it("builds documented METRC growth phase payload with StartingTag", () => {
    const body = buildMetrcPlantBatchGrowthPhaseBody({
      plantBatchName: "AAA00080000196B000009999",
      growthPhase: "Flowering",
      count: 2,
      startingTag: "AAA00010000196B000000042",
      growthDate: "2026-05-28",
      locationName: "SBX Default Location Type Location 1",
    });

    expect(body).toEqual([
      {
        Name: "AAA00080000196B000009999",
        CountPerPlant: null,
        Count: 2,
        StartingTag: "AAA00010000196B000000042",
        GrowthPhase: "Flowering",
        NewLocation: "SBX Default Location Type Location 1",
        NewSublocation: null,
        GrowthDate: "2026-05-28",
        PatientLicenseNumber: null,
      },
    ]);
    expect(body[0]).not.toHaveProperty("ActualDate");
    expect(body[0]).not.toHaveProperty("ChangeDate");
    expect(body[0]).not.toHaveProperty("Note");
  });

  it("uses null NewLocation when location is omitted", () => {
    const body = buildMetrcPlantBatchGrowthPhaseBody({
      plantBatchName: "AAA00080000196B000009999",
      growthPhase: "Vegetative",
      count: 1,
      startingTag: "AAA00010000196B000000043",
      growthDate: "2026-05-28",
    });

    expect((body[0] as { NewLocation: unknown }).NewLocation).toBeNull();
  });
});
