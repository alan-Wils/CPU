import { describe, expect, it } from "vitest";
import {
  applyMetrcOperationalSuccess,
  isMetrcSandboxPlaceholderLicense,
  mergeMetrcOperationalLicense,
  normalizeMetrcFacilityDisplayName,
  pickMetrcFacilityNameFromLocations,
} from "./metrcOperationalStatus.js";

describe("metrcOperationalStatus", () => {
  it("detects sandbox placeholder licenses", () => {
    expect(isMetrcSandboxPlaceholderLicense("SBX-CO")).toBe(true);
    expect(isMetrcSandboxPlaceholderLicense("SF-SBX-CO-1-13402")).toBe(false);
  });

  it("keeps real facility license when setup returns SBX-CO", () => {
    expect(
      mergeMetrcOperationalLicense("SF-SBX-CO-1-13402", "SBX-CO"),
    ).toBe("SF-SBX-CO-1-13402");
    expect(mergeMetrcOperationalLicense("SBX-CO", "SF-SBX-CO-1-13402")).toBe(
      "SF-SBX-CO-1-13402",
    );
  });

  it("normalizes facility display names", () => {
    expect(
      normalizeMetrcFacilityDisplayName("SBX Centralized Processing Hub Location 1"),
    ).toBe("SBX Centralized Processing Hub");
  });

  it("picks facility name from locations payload", () => {
    expect(
      pickMetrcFacilityNameFromLocations({
        Data: [{ Name: "SBX Centralized Processing Hub Location 1" }],
      }),
    ).toBe("SBX Centralized Processing Hub");
  });

  it("marks sandbox operational success on config", () => {
    const next = applyMetrcOperationalSuccess(
      { licenseNumber: "SBX-CO", facilityName: "" },
      {
        operationalLicense: "SF-SBX-CO-1-13402",
        facilityName: "SBX Centralized Processing Hub",
      },
    );
    expect(next.sandboxReady).toBe(true);
    expect(next.metrcOperationalAccessGranted).toBe(true);
    expect(next.metrcSandboxOperationalStatus).toBe("connected");
    expect(next.licenseNumber).toBe("SF-SBX-CO-1-13402");
    expect(next.facilityName).toBe("SBX Centralized Processing Hub");
  });
});
