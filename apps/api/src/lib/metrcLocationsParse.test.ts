import { describe, expect, it } from "vitest";
import { parseMetrcLocationsPayload } from "./metrcLocationsParse.js";

describe("metrcLocationsParse", () => {
  it("parses METRC active locations", () => {
    const rows = parseMetrcLocationsPayload({
      Data: [
        {
          Id: 42,
          Name: "SBX Centralized Processing Hub Location 1",
          LocationTypeId: 3,
          LocationTypeName: "Default",
          ForPlants: false,
          ForHarvests: false,
          ForPackages: true,
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metrcLocationId).toBe("42");
    expect(rows[0]?.name).toContain("SBX Centralized");
    expect(rows[0]?.locationTypeId).toBe(3);
    expect(rows[0]?.forPackages).toBe(true);
  });
});
