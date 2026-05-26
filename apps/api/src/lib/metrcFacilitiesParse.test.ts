import { describe, expect, it } from "vitest";
import {
  parseMetrcFacilitiesPayload,
  pickMetrcFacilityNameFromFacilities,
  pickPrimaryMetrcOperationalLicense,
} from "./metrcFacilitiesParse.js";

describe("metrcFacilitiesParse", () => {
  it("parses METRC facilities payload rows", () => {
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
    expect(rows[0]?.facilityType).toBe("Processor");
    expect(rows[0]?.active).toBe(true);
    expect(rows[0]?.capabilities.CanTrackPackaged).toBe(true);
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
