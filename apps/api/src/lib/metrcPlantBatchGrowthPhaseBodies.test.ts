import { describe, expect, it } from "vitest";
import { buildMetrcPlantBatchGrowthPhaseBody } from "./metrcPlantBatchGrowthPhaseBodies.js";

describe("buildMetrcPlantBatchGrowthPhaseBody", () => {
  it("builds METRC evaluation growth phase payload", () => {
    const body = buildMetrcPlantBatchGrowthPhaseBody({
      plantBatchName: "AAA00080000196B000009999",
      growthPhase: "Flowering",
      count: 2,
      actualDate: "2026-05-27",
    });

    expect(body).toEqual([
      {
        Name: "AAA00080000196B000009999",
        GrowthPhase: "Flowering",
        Count: 2,
        GrowthDate: "2026-05-27",
      },
    ]);
    expect(body[0]).not.toHaveProperty("ActualDate");
    expect(body[0]).not.toHaveProperty("ChangeDate");
  });

  it("includes optional location and note when provided", () => {
    const body = buildMetrcPlantBatchGrowthPhaseBody({
      plantBatchName: "AAA00080000196B000009999",
      growthPhase: "Vegetative",
      count: 1,
      actualDate: "2026-05-27",
      locationName: "SBX Default Location Type Location 1",
      note: "Evaluation note.",
    });

    expect(body[0]).toMatchObject({
      GrowthDate: "2026-05-27",
      NewLocation: "SBX Default Location Type Location 1",
      Note: "Evaluation note.",
    });
    expect(body[0]).not.toHaveProperty("ActualDate");
    expect(body[0]).not.toHaveProperty("ChangeDate");
  });
});
