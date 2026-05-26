import { describe, expect, it } from "vitest";
import {
  buildMetrcLocationsActivePathname,
  buildMetrcLocationsActiveQueryString,
  defaultMetrcLocationsDateRange,
  parseMetrcFacilityLicenseRows,
  pickMetrcFacilityLicenseRow,
} from "./metrcLocationsActiveQuery.js";

describe("metrcLocationsActiveQuery", () => {
  it("builds documented query string shape", () => {
    const q = buildMetrcLocationsActiveQueryString({
      licenseNumber: "SF-SBX-CO-1-13402",
      lastModifiedStart: "2026-04-01",
      lastModifiedEnd: "2026-05-22",
      pageNumber: 1,
      pageSize: 20,
    });
    expect(q).toBe(
      "?licenseNumber=SF-SBX-CO-1-13402&lastModifiedStart=2026-04-01&lastModifiedEnd=2026-05-22&pageNumber=1&pageSize=20",
    );
    expect(buildMetrcLocationsActivePathname({
      licenseNumber: "SF-SBX-CO-1-13402",
      lastModifiedStart: "2026-04-01",
      lastModifiedEnd: "2026-05-22",
      pageNumber: 1,
      pageSize: 20,
    })).toBe(`/locations/v2/active${q}`);
  });

  it("uses facility StartDate when present", () => {
    const range = defaultMetrcLocationsDateRange("2026-03-15");
    expect(range.lastModifiedStart).toBe("2026-03-15");
    expect(range.lastModifiedEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("parses facilities payload for license and start date", () => {
    const rows = parseMetrcFacilityLicenseRows({
      Data: [
        {
          LicenseNumber: "SF-SBX-CO-1-13402",
          StartDate: "2026-01-10T00:00:00",
        },
      ],
    });
    expect(rows).toEqual([
      { licenseNumber: "SF-SBX-CO-1-13402", startDate: "2026-01-10" },
    ]);
  });

  it("prefers config license match in facilities list", () => {
    const picked = pickMetrcFacilityLicenseRow(
      [
        { licenseNumber: "SF-SBX-CO-1-13402", startDate: "2026-01-10" },
        { licenseNumber: "OTHER", startDate: null },
      ],
      "SF-SBX-CO-1-13402",
    );
    expect(picked?.licenseNumber).toBe("SF-SBX-CO-1-13402");
  });
});
