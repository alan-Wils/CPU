import { describe, expect, it } from "vitest";
import { extractFinishChecklistPackageRefFromPayloads } from "./metrcFinishChecklistPackageRef.js";

describe("extractFinishChecklistPackageRefFromPayloads", () => {
  it("reads selectedPackageLabel from nested finish responsePayload", () => {
    const ref = extractFinishChecklistPackageRefFromPayloads({
      responsePayload: {
        ok: true,
        packageLabel: "",
        responsePayload: {
          selectedPackageLabel: "AAA00090000196B000000014",
          selectedReason: "newest_evaluation_created_package",
          licenseNumber: "SF-SBX-CO-7-13402",
        },
      },
    });

    expect(ref?.packageLabel).toBe("AAA00090000196B000000014");
    expect(ref?.licenseNumber).toBe("SF-SBX-CO-7-13402");
  });

  it("reads label from finish requestPayload package and METRC body", () => {
    const ref = extractFinishChecklistPackageRefFromPayloads({
      responsePayload: { ok: true },
      requestPayload: {
        body: [{ Label: "AAA00090000196B000000014", ActualDate: "2026-05-27" }],
        package: {
          packageLabel: "AAA00090000196B000000014",
          licenseNumber: "SF-SBX-CO-7-13402",
        },
      },
    });

    expect(ref?.packageLabel).toBe("AAA00090000196B000000014");
  });
});
