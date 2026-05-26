import { describe, expect, it } from "vitest";
import { formatMetrcDisplayLabel, formatMetrcFacilityTypeLabel } from "./metrcDisplayLabel";

describe("metrcDisplayLabel", () => {
  it("never returns [object Object] for nested METRC objects", () => {
    expect(formatMetrcDisplayLabel({ Name: "Cultivation" })).toBe("Cultivation");
    expect(formatMetrcFacilityTypeLabel({ facilityType: { NameDisplay: "Processor" } })).toBe(
      "Processor",
    );
    expect(formatMetrcFacilityTypeLabel({ facilityTypeName: "Retail" })).toBe("Retail");
    expect(formatMetrcFacilityTypeLabel({ facilityType: "[object Object]" })).toBe("");
  });
});
