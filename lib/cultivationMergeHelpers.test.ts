import { describe, expect, it } from "vitest";
import {
  cultivationStageFromCombineBucket,
  findCombineMergeDataForPair,
  resolveAbsorbedPlantsAndStageForUncombine,
} from "@/lib/cultivationMergeHelpers";

describe("cultivationMergeHelpers", () => {
  it("findCombineMergeDataForPair matches survivor and absorbed ids", () => {
    const logs = [
      { task: "Maintenance", batch: "X" },
      {
        task: "Combine Batches",
        batch: "P",
        data: {
          combineBatches: true,
          survivorBatchId: "SUV",
          absorbedBatchId: "ABS",
          plantsBeforePartner: 12,
          plantsBeforeSurvivor: 8,
          plantsAfterCombine: 20,
          stageBucket: "Veg",
        },
      },
    ];
    expect(findCombineMergeDataForPair(logs, "SUV", "ABS")).toMatchObject({
      plantsBeforePartner: 12,
      stageBucket: "Veg",
    });
    expect(findCombineMergeDataForPair(logs, "SUV", "NOP")).toBeNull();
  });

  it("cultivationStageFromCombineBucket maps bucket labels", () => {
    expect(cultivationStageFromCombineBucket("Clones")).toBe("Clone");
    expect(cultivationStageFromCombineBucket("Veg")).toBe("Veg");
    expect(cultivationStageFromCombineBucket("Flower")).toBe("Flower");
    expect(cultivationStageFromCombineBucket("")).toBe("Clone");
  });

  it("resolveAbsorbedPlantsAndStageForUncombine prefers snapshot plants and stage", () => {
    const partner = {
      mergedIntoSnapshot: {
        plantsAbsorbed: 15,
        stageBeforeMerge: "Veg",
      },
    };
    expect(resolveAbsorbedPlantsAndStageForUncombine(partner, [], "S", "P")).toEqual({
      plants: 15,
      stage: "Veg",
    });
  });

  it("resolveAbsorbedPlantsAndStageForUncombine falls back to logs when snapshot incomplete", () => {
    const partner = { mergedIntoSnapshot: {} };
    const logs = [
      {
        task: "Combine Batches",
        data: {
          combineBatches: true,
          survivorBatchId: "AA",
          absorbedBatchId: "BB",
          plantsBeforePartner: 7,
          stageBucket: "Clones",
        },
      },
    ];
    expect(resolveAbsorbedPlantsAndStageForUncombine(partner, logs, "AA", "BB")).toEqual({
      plants: 7,
      stage: "Clone",
    });
  });

  it("resolveAbsorbedPlantsAndStageForUncombine returns null when plants cannot be resolved", () => {
    const partner = {};
    expect(resolveAbsorbedPlantsAndStageForUncombine(partner, [], "S", "P")).toBeNull();
  });
});
