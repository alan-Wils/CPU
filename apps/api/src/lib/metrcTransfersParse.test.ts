import { describe, expect, it } from "vitest";
import { parseMetrcTransfersPayload } from "./metrcTransfersParse.js";

describe("metrcTransfersParse", () => {
  it("parses outgoing transfer list payload", () => {
    const rows = parseMetrcTransfersPayload(
      {
        Data: [
          {
            Id: 42,
            ManifestNumber: "0000000042",
            ShipmentTypeName: "Wholesale",
            TransporterFacilityLicenseNumber: "T-1",
            TransporterFacilityName: "Transporter A",
            RecipientFacilityLicenseNumber: "R-1",
            RecipientFacilityName: "Recipient B",
            PackageCount: 2,
            ReceivedPackageCount: 0,
            IsVoided: false,
            EstimatedDepartureDateTime: "2026-05-26T10:00:00.000",
          },
        ],
      },
      "outgoing",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metrcTransferId).toBe("42");
    expect(rows[0]?.manifestNumber).toBe("0000000042");
    expect(rows[0]?.direction).toBe("outgoing");
    expect(rows[0]?.status).toBe("active");
    expect(rows[0]?.destinationFacility).toContain("R-1");
  });
});
