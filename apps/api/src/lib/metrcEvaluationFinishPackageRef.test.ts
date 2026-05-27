import { describe, expect, it } from "vitest";
import {
  extractFinishPackageRefFromPayloads,
  isSuccessfulEvaluationFinishLog,
} from "./metrcEvaluationFinishPackageRef.js";

describe("metrcEvaluationFinishPackageRef", () => {
  it("treats idempotent METRC 400 finish logs as successful", () => {
    expect(
      isSuccessfulEvaluationFinishLog({
        httpStatus: 400,
        responsePayload: { ok: true, alreadyFinished: true },
      }),
    ).toBe(true);
  });

  it("extracts label from response packageLabel on finish response", () => {
    const ref = extractFinishPackageRefFromPayloads({
      responsePayload: {
        ok: true,
        packageLabel: "AAA00090000196B000000007",
        licenseNumber: "SF-SBX-CO-7-13402",
        evaluationPackage: {
          packageLabel: "AAA00090000196B000000007",
          packageId: "46907",
          licenseNumber: "SF-SBX-CO-7-13402",
        },
      },
    });
    expect(ref).toEqual({
      packageLabel: "AAA00090000196B000000007",
      packageId: null,
      licenseNumber: "SF-SBX-CO-7-13402",
    });
  });

  it("extracts label from spreadsheetFields.tagNumber", () => {
    const ref = extractFinishPackageRefFromPayloads({
      responsePayload: {
        spreadsheetFields: { tagNumber: "AAA00090000196B000000008" },
      },
      licenseFallback: "SF-SBX-CO-7-13402",
    });
    expect(ref?.packageLabel).toBe("AAA00090000196B000000008");
  });

  it("extracts label from finish request body Label", () => {
    const ref = extractFinishPackageRefFromPayloads({
      requestPayload: {
        body: [{ Label: "AAA00090000196B000000009", ActualDate: "2026-05-27" }],
        package: { packageLabel: "AAA00090000196B000000009" },
      },
    });
    expect(ref?.packageLabel).toBe("AAA00090000196B000000009");
  });
});
