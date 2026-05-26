import { describe, expect, it } from "vitest";
import { parseMetrcPlantBatchesPayload } from "./metrcPlantBatchesParse.js";

describe("parseMetrcPlantBatchesPayload", () => {
  it("parses active plant batch rows with strain and location", () => {
    const rows = parseMetrcPlantBatchesPayload([
      {
        Id: 42,
        Name: "Clone Batch A",
        StrainName: "Blue Dream",
        StrainId: 7,
        TrackedCount: 25,
        LocationId: 99,
        LocationName: "Veg Room 1",
        PlantedDate: "2026-05-01",
        LastModified: "2026-05-20T12:00:00Z",
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metrcPlantBatchId).toBe("42");
    expect(rows[0]?.name).toBe("Clone Batch A");
    expect(rows[0]?.strainName).toBe("Blue Dream");
    expect(rows[0]?.metrcStrainId).toBe("7");
    expect(rows[0]?.count).toBe(25);
    expect(rows[0]?.metrcLocationId).toBe("99");
    expect(rows[0]?.locationName).toBe("Veg Room 1");
  });
});
