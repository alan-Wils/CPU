import { describe, expect, it } from "vitest";
import { parseMetrcPlantsPayload } from "./metrcPlantsParse.js";

describe("parseMetrcPlantsPayload", () => {
  it("parses flowering plant rows with batch linkage", () => {
    const rows = parseMetrcPlantsPayload(
      [
        {
          Id: 10011,
          Label: "ABCDEF012345670000010011",
          PlantBatchId: 2,
          PlantBatchName: "BLDR.05.26.26",
          StrainName: "NexBatch Test Strain",
          LocationName: "Veg Room A",
          GrowthPhase: "Flowering",
          State: "Tracked",
        },
      ],
      "flowering",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe("ABCDEF012345670000010011");
    expect(rows[0]?.sourcePlantBatchName).toBe("BLDR.05.26.26");
    expect(rows[0]?.growthPhase).toBe("Flowering");
  });
});
