import { describe, expect, it } from "vitest";
import {
  METRC_FACILITIES_V2_EXAMPLE_ROW,
  METRC_FACILITIES_V2_PROCESSOR_ROW,
} from "./metrcFacilitiesV2Fixture.js";
import {
  parseMetrcFacilitiesPayload,
  pickMetrcFacilityNameFromFacilities,
  pickPrimaryMetrcOperationalLicense,
  resolveMetrcFacilityTypeNameFromPayload,
} from "./metrcFacilitiesParse.js";

describe("metrcFacilitiesParse", () => {
  it("reads facility type from License.LicenseType (METRC /facilities/v2 shape)", () => {
    const rows = parseMetrcFacilitiesPayload({ Data: [METRC_FACILITIES_V2_EXAMPLE_ROW] }, "CO");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.licenseNumber).toBe("403-X0001");
    expect(rows[0]?.facilityTypeName).toBe("Medical Cultivation");
    expect(rows[0]?.facilityType).toBe("Medical Cultivation");
  });

  it("does not treat FacilityType capability flags as a display name", () => {
    const rows = parseMetrcFacilitiesPayload(
      { Data: [METRC_FACILITIES_V2_PROCESSOR_ROW] },
      "CO",
    );
    expect(rows[0]?.facilityTypeName).toBe("Processor");
    expect(rows[0]?.facilityType).toBe("Processor");
    expect(rows[0]?.licenseNumber).toBe("SF-SBX-CO-1-13402");
  });

  it("supports legacy top-level FacilityTypeName when present", () => {
    const rows = parseMetrcFacilitiesPayload(
      {
        Data: [
          {
            LicenseNumber: "SF-SBX-CO-1-13402",
            Name: "SBX Centralized Processing Hub Location 1",
            FacilityTypeName: "Processor",
            IsActive: true,
            CanTrackPackaged: true,
          },
        ],
      },
      "CO",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.licenseNumber).toBe("SF-SBX-CO-1-13402");
    expect(rows[0]?.facilityName).toBe("SBX Centralized Processing Hub");
    expect(rows[0]?.facilityTypeName).toBe("Processor");
    expect(rows[0]?.active).toBe(true);
    expect(rows[0]?.capabilities.CanTrackPackaged).toBe(true);
  });

  it("re-parses facility type from stored raw payload JSON", () => {
    const raw = JSON.stringify(METRC_FACILITIES_V2_EXAMPLE_ROW);
    expect(resolveMetrcFacilityTypeNameFromPayload(raw)).toBe("Medical Cultivation");
  });

  it("picks primary operational license and display name", () => {
    const rows = parseMetrcFacilitiesPayload(
      {
        Data: [
          { LicenseNumber: "SBX-CO", Name: "Placeholder" },
          { LicenseNumber: "SF-SBX-CO-1-13402", Name: "SBX Centralized Processing Hub" },
        ],
      },
      "CO",
    );
    expect(pickPrimaryMetrcOperationalLicense(rows)).toBe("SF-SBX-CO-1-13402");
    expect(pickMetrcFacilityNameFromFacilities(rows, "SF-SBX-CO-1-13402")).toBe(
      "SBX Centralized Processing Hub",
    );
  });
});
