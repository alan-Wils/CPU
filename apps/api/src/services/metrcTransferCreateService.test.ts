import { describe, expect, it } from "vitest";
import {
  buildMetrcTransferTemplateCreateBody,
  buildTransferTemplateCreatePathCandidates,
} from "./metrcTransferCreateService.js";

describe("metrcTransferCreateService", () => {
  it("builds v2 then v1 template create paths", () => {
    const paths = buildTransferTemplateCreatePathCandidates("SF-SBX-001");
    expect(paths[0]).toContain("/transfers/v2/templates/outgoing");
    expect(paths[1]).toContain("/transfers/v1/templates");
    expect(paths[0]).toContain("licenseNumber=");
  });

  it("builds transfer template body with package and destination", () => {
    const body = buildMetrcTransferTemplateCreateBody({
      name: "NexBatch Test Transfer",
      sourceLicense: "SF-SBX-001",
      destinationLicense: "SF-SBX-002",
      packageLabel: "1A4FF0000000000000000001",
      transferDate: "2026-05-26",
      plannedRoute: "Direct route for sandbox evaluation.",
      notes: null,
      transporterFacilityLicense: null,
      transferTypeName: "Transfer",
      grossWeight: 10,
      grossUnitOfWeightName: "Grams",
    });
    expect(Array.isArray(body)).toBe(true);
    const row = body[0] as {
      Destinations?: Array<{ RecipientLicenseNumber?: string; Packages?: unknown[] }>;
    };
    expect(row.Destinations?.[0]?.RecipientLicenseNumber).toBe("SF-SBX-002");
    const pkg = row.Destinations?.[0]?.Packages?.[0] as { PackageLabel?: string };
    expect(pkg.PackageLabel).toBe("1A4FF0000000000000000001");
  });
});
