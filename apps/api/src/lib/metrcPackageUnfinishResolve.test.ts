import { beforeEach, describe, expect, it, vi } from "vitest";

const getLatestFinishRefMock = vi.hoisted(() => vi.fn());

vi.mock("./metrcEvaluationFinishPackageRef.js", () => ({
  getLatestEvaluationFinishPackageRef: getLatestFinishRefMock,
}));

import { MetrcEvaluationPackageNotFoundError } from "./metrcPackageResolve.js";
import { resolveUnfinishPackageForEvaluation } from "./metrcPackageUnfinishResolve.js";

describe("resolveUnfinishPackageForEvaluation", () => {
  beforeEach(() => {
    getLatestFinishRefMock.mockReset();
    getLatestFinishRefMock.mockResolvedValue(null);
  });

  it("uses request package label even when it matches the evaluation default tag", async () => {
    const pkg = await resolveUnfinishPackageForEvaluation({
      companyId: "c1",
      packageLabel: "AAA00090000196B000000001",
      packageId: "46601",
      licenseNumber: "SF-SBX-CO-7-13402",
    });

    expect(pkg.packageLabel).toBe("AAA00090000196B000000001");
    expect(pkg.packageId).toBe("46601");
    expect(pkg.licenseNumber).toBe("SF-SBX-CO-7-13402");
    expect(pkg.isFinished).toBe(true);
    expect(pkg.selectedReason).toBe("package_label_from_finish_checklist_result");
    expect(getLatestFinishRefMock).not.toHaveBeenCalled();
  });

  it("falls back to latest evaluation_finish log when request label is empty", async () => {
    getLatestFinishRefMock.mockResolvedValue({
      packageLabel: "AAA00090000196B000000001",
      packageId: "46601",
      licenseNumber: "SF-SBX-CO-7-13402",
      finishedAt: new Date("2026-05-27T12:00:00.000Z"),
    });

    const pkg = await resolveUnfinishPackageForEvaluation({
      companyId: "c1",
      packageLabel: "",
      licenseNumber: "SF-SBX-CO-7-13402",
    });

    expect(pkg.packageLabel).toBe("AAA00090000196B000000001");
    expect(pkg.selectedReason).toBe("from_latest_package_finish_log");
  });

  it("throws when no finish label is available", async () => {
    await expect(
      resolveUnfinishPackageForEvaluation({
        companyId: "c1",
        packageLabel: "",
      }),
    ).rejects.toBeInstanceOf(MetrcEvaluationPackageNotFoundError);
  });
});
