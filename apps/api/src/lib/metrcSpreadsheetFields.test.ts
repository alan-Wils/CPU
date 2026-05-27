import { describe, expect, it } from "vitest";
import { buildMetrcSpreadsheetFields } from "./metrcSpreadsheetFields.js";

describe("metrcSpreadsheetFields", () => {
  it("builds spreadsheet-ready evaluation fields", () => {
    const fields = buildMetrcSpreadsheetFields({
      httpStatus: 200,
      licenseNumber: "SF-SBX-CO-7-13402",
      packageId: "46601",
      packageLabel: "AAA00090000196B000000001",
      requestBody: [{ Label: "AAA00090000196B000000001" }],
      responsePayload: { ok: true },
      lastModifiedDate: "2026-05-26",
    });
    expect(fields.resultCode).toBe(200);
    expect(fields.licenseFacility).toBe("SF-SBX-CO-7-13402");
    expect(fields.idNumber).toBe("46601");
    expect(fields.tagNumber).toBe("AAA00090000196B000000001");
    expect(fields.lastModifiedDate).toBe("2026-05-26");
    expect(fields.requestSent).toContain("Label");
    expect(fields.minifiedJsonForSpreadsheet).toContain('"request"');
  });
});
