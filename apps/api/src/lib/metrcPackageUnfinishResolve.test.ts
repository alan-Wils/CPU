import { describe, expect, it } from "vitest";
import { MetrcEvaluationPackageNotFoundError } from "./metrcPackageResolve.js";
import {
  resolveUnfinishPackageForEvaluation,
  UNFINISH_FROM_FINISH_REASON,
} from "./metrcPackageUnfinishResolve.js";

describe("resolveUnfinishPackageForEvaluation", () => {
  it("uses request package label with latest_finish_result diagnostics reason", async () => {
    const pkg = await resolveUnfinishPackageForEvaluation({
      companyId: "c1",
      packageLabel: "AAA00090000196B000000014",
      packageId: "46914",
      licenseNumber: "SF-SBX-CO-7-13402",
    });

    expect(pkg.packageLabel).toBe("AAA00090000196B000000014");
    expect(pkg.selectedReason).toBe(UNFINISH_FROM_FINISH_REASON);
    expect(pkg.isFinished).toBe(true);
  });

  it("accepts selectedPackageLabel from finish checklist body", async () => {
    const pkg = await resolveUnfinishPackageForEvaluation({
      companyId: "c1",
      selectedPackageLabel: "AAA00090000196B000000014",
      licenseNumber: "SF-SBX-CO-7-13402",
    });

    expect(pkg.packageLabel).toBe("AAA00090000196B000000014");
    expect(pkg.selectedReason).toBe(UNFINISH_FROM_FINISH_REASON);
  });

  it("extracts label from embedded finish checklist payloads", async () => {
    const pkg = await resolveUnfinishPackageForEvaluation({
      companyId: "c1",
      finishChecklistResponse: {
        responsePayload: {
          selectedPackageLabel: "AAA00090000196B000000014",
          licenseNumber: "SF-SBX-CO-7-13402",
        },
      },
    });

    expect(pkg.packageLabel).toBe("AAA00090000196B000000014");
  });

  it("throws when no finish checklist label is available", async () => {
    await expect(
      resolveUnfinishPackageForEvaluation({
        companyId: "c1",
        packageLabel: "",
      }),
    ).rejects.toBeInstanceOf(MetrcEvaluationPackageNotFoundError);
  });
});
