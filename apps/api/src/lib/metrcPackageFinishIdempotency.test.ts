import { describe, expect, it } from "vitest";
import {
  buildFinishPackageIdempotentSpreadsheetFields,
  isMetrcPackageAlreadyFinishedMessage,
} from "./metrcPackageFinishIdempotency.js";

describe("isMetrcPackageAlreadyFinishedMessage", () => {
  it("detects METRC already finished errors", () => {
    expect(
      isMetrcPackageAlreadyFinishedMessage(
        "Package AAA00090000196B000000001 is already Finished.",
      ),
    ).toBe(true);
    expect(isMetrcPackageAlreadyFinishedMessage("already finished")).toBe(true);
    expect(isMetrcPackageAlreadyFinishedMessage("Package not found")).toBe(false);
  });
});

describe("buildFinishPackageIdempotentSpreadsheetFields", () => {
  it("uses resultCode 200 and minified Already Finished payload", () => {
    const fields = buildFinishPackageIdempotentSpreadsheetFields({
      licenseNumber: "SF-SBX-CO-7-13402",
      packageId: "46601",
      packageLabel: "AAA00090000196B000000001",
      requestBody: [{ Label: "AAA00090000196B000000001" }],
      result: "Already Finished",
    });

    expect(fields.resultCode).toBe(200);
    expect(fields.tagNumber).toBe("AAA00090000196B000000001");
    expect(fields.minifiedJsonForSpreadsheet).toBe(
      JSON.stringify({
        Label: "AAA00090000196B000000001",
        Result: "Already Finished",
      }),
    );
  });
});
