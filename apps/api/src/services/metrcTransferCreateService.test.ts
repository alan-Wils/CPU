import { describe, expect, it } from "vitest";
import {
  buildMetrcTransferTemplateCreateBody,
  buildTransferTemplateCreatePathCandidates,
  buildTransferTemplatePayloadDiagnostics,
} from "./metrcTransferCreateService.js";

const baseInput = {
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
};

describe("metrcTransferCreateService", () => {
  it("builds v2 then v1 template create paths", () => {
    const paths = buildTransferTemplateCreatePathCandidates("SF-SBX-001");
    expect(paths[0]).toContain("/transfers/v2/templates/outgoing");
    expect(paths[1]).toContain("/transfers/v1/templates");
    expect(paths[0]).toContain("licenseNumber=");
  });

  it("puts TransferTypeName on destination for v2", () => {
    const body = buildMetrcTransferTemplateCreateBody(baseInput, "v2");
    const row = body[0] as {
      TransferTypeName?: string;
      Destinations?: Array<{ TransferTypeName?: string; RecipientLicenseNumber?: string }>;
    };
    expect(row.TransferTypeName).toBeUndefined();
    expect(row.Destinations?.[0]?.TransferTypeName).toBe("Transfer");
    expect(row.Destinations?.[0]?.RecipientLicenseNumber).toBe("SF-SBX-002");
  });

  it("puts TransferTypeName at top level for v1 (not on destination)", () => {
    const body = buildMetrcTransferTemplateCreateBody(baseInput, "v1");
    const row = body[0] as {
      TransferTypeName?: string;
      Destinations?: Array<{ TransferTypeName?: string; RecipientLicenseNumber?: string }>;
    };
    expect(row.TransferTypeName).toBe("Transfer");
    expect(row.Destinations?.[0]?.TransferTypeName).toBeUndefined();
    expect(row.Destinations?.[0]?.RecipientLicenseNumber).toBe("SF-SBX-002");
    const pkg = row.Destinations?.[0]?.Packages as Array<{ PackageLabel?: string }> | undefined;
    expect(pkg?.[0]?.PackageLabel).toBe("1A4FF0000000000000000001");
  });

  it("builds payload diagnostics from v1 body", () => {
    const pathname = "/transfers/v1/templates?licenseNumber=SF-SBX-001";
    const body = buildMetrcTransferTemplateCreateBody(baseInput, "v1");
    const diagnostics = buildTransferTemplatePayloadDiagnostics({
      pathname,
      transferTypeName: "Transfer",
      destinationLicense: "SF-SBX-002",
      packageLabel: baseInput.packageLabel,
      body,
    });
    expect(diagnostics.endpoint).toBe("/transfers/v1/templates");
    expect(diagnostics.apiVersion).toBe("v1");
    expect(diagnostics.topLevelTransferTypeName).toBe("Transfer");
    expect(diagnostics.destinationRecipientLicense).toBe("SF-SBX-002");
    expect(diagnostics.packageLabels).toEqual([baseInput.packageLabel]);
  });
});
