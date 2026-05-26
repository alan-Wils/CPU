import { describe, expect, it } from "vitest";
import { parseMetrcHarvestsPayload } from "./metrcHarvestsParse.js";

describe("parseMetrcHarvestsPayload", () => {
  it("parses active harvest rows with drying location and weights", () => {
    const rows = parseMetrcHarvestsPayload([
      {
        Id: 42,
        Name: "NexBatch Test Harvest",
        HarvestType: "Product",
        DryingLocationId: 7,
        DryingLocationName: "Veg Room A",
        TotalWetWeight: 100,
        CurrentWeight: 95,
        UnitOfWeightName: "Grams",
        HarvestStartDate: "2026-05-26",
        SourceStrainNames: "NexBatch Test Strain",
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metrcHarvestId).toBe("42");
    expect(rows[0]?.harvestName).toBe("NexBatch Test Harvest");
    expect(rows[0]?.strainName).toBe("NexBatch Test Strain");
    expect(rows[0]?.locationName).toBe("Veg Room A");
    expect(rows[0]?.wetWeight).toBe(100);
    expect(rows[0]?.active).toBe(true);
  });
});
