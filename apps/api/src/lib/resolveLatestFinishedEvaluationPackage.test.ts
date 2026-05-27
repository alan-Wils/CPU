import { describe, expect, it } from "vitest";
import {
  LATEST_FINISH_RESULT_REASON,
  resolveFinishChecklistMetrcRequestPayload,
  resolveLatestFinishedEvaluationPackage,
} from "./resolveLatestFinishedEvaluationPackage.js";

describe("resolveLatestFinishedEvaluationPackage", () => {
  it("prefers response packageLabel then selectedPackageLabel across nested payloads", () => {
    const resolved = resolveLatestFinishedEvaluationPackage({
      responsePayload: {
        ok: true,
        packageLabel: "AAA00090000196B000000015",
        licenseNumber: "SF-SBX-CO-7-13402",
        responsePayload: {
          selectedPackageLabel: "AAA00090000196B000000099",
        },
      },
      requestPayload: {
        method: "POST",
        body: { packageLabel: "" },
      },
    });

    expect(resolved).toEqual({
      packageLabel: "AAA00090000196B000000015",
      licenseNumber: "SF-SBX-CO-7-13402",
      selectedReason: LATEST_FINISH_RESULT_REASON,
    });
  });

  it("reads selectedPackageLabel and METRC request body when top label is empty", () => {
    const responsePayload = {
      ok: true,
      licenseNumber: "SF-SBX-CO-7-13402",
      responsePayload: {
        selectedPackageLabel: "AAA00090000196B000000015",
      },
      requestPayload: {
        body: [{ Label: "AAA00090000196B000000015", ActualDate: "2026-05-27" }],
        package: {
          packageLabel: "AAA00090000196B000000015",
          licenseNumber: "SF-SBX-CO-7-13402",
        },
      },
    };

    const resolved = resolveLatestFinishedEvaluationPackage({
      responsePayload,
      requestPayload: { method: "POST", body: { packageLabel: "" } },
    });

    expect(resolved?.packageLabel).toBe("AAA00090000196B000000015");
    expect(resolved?.selectedReason).toBe(LATEST_FINISH_RESULT_REASON);
  });

  it("uses spreadsheet tagNumber when other response labels are absent", () => {
    const resolved = resolveLatestFinishedEvaluationPackage({
      responsePayload: {
        spreadsheetFields: { tagNumber: "AAA00090000196B000000015" },
      },
      requestPayload: null,
    });

    expect(resolved?.packageLabel).toBe("AAA00090000196B000000015");
  });

  it("returns null when finish checklist has no label", () => {
    expect(
      resolveLatestFinishedEvaluationPackage({
        responsePayload: { ok: true },
        requestPayload: { body: { packageLabel: "" } },
      }),
    ).toBeNull();
  });
});

describe("resolveFinishChecklistMetrcRequestPayload", () => {
  it("prefers nested API requestPayload over evaluation wrapper", () => {
    const metrcRequest = { package: { packageLabel: "AAA00090000196B000000015" } };
    expect(
      resolveFinishChecklistMetrcRequestPayload(
        { requestPayload: metrcRequest },
        { method: "POST", body: { packageLabel: "" } },
      ),
    ).toBe(metrcRequest);
  });
});
