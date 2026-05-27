import { describe, expect, it } from "vitest";
import { incrementMetrcTag, pickLatestSandboxPackageLabel } from "./metrcPackageTagGenerator.js";

describe("incrementMetrcTag", () => {
  it("increments zero-padded METRC suffix", () => {
    expect(incrementMetrcTag("AAA00090000196B000000001")).toBe("AAA00090000196B000000002");
    expect(incrementMetrcTag("AAA00090000196B000000002")).toBe("AAA00090000196B000000003");
    expect(incrementMetrcTag("AAA00090000196B000000003")).toBe("AAA00090000196B000000004");
  });

  it("preserves prefix and padding width", () => {
    expect(incrementMetrcTag("PREFIX00099")).toBe("PREFIX00100");
  });
});

describe("pickLatestSandboxPackageLabel", () => {
  const rows = [
    {
      packageLabel: "AAA00090000196B000000001",
      licenseNumber: "SF-SBX-CO-7-13402",
      lastSyncedAt: new Date("2026-05-20T10:00:00Z"),
    },
    {
      packageLabel: "AAA00090000196B000000003",
      licenseNumber: "SF-SBX-CO-7-13402",
      lastSyncedAt: new Date("2026-05-26T12:00:00Z"),
    },
    {
      packageLabel: "AAA00090000196B000000002",
      licenseNumber: "SF-SBX-CO-7-13402",
      lastSyncedAt: new Date("2026-05-25T12:00:00Z"),
    },
  ];

  it("returns newest synced label for sandbox license", () => {
    expect(pickLatestSandboxPackageLabel(rows, "SF-SBX-CO-7-13402")).toBe(
      "AAA00090000196B000000003",
    );
  });

  it("filters by license when provided", () => {
    const mixed = [
      ...rows,
      {
        packageLabel: "OTHER000000001",
        licenseNumber: "OTHER-LIC",
        lastSyncedAt: new Date("2026-05-27T12:00:00Z"),
      },
    ];
    expect(pickLatestSandboxPackageLabel(mixed, "SF-SBX-CO-7-13402")).toBe(
      "AAA00090000196B000000003",
    );
  });
});
