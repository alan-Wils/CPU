import { beforeEach, describe, expect, it, vi } from "vitest";

const { listPackagesMock, listLogsMock, listCreatedRefsMock } = vi.hoisted(() => ({
  listPackagesMock: vi.fn(),
  listLogsMock: vi.fn(),
  listCreatedRefsMock: vi.fn(),
}));

vi.mock("../repositories/metrcPackageRepository.js", () => ({
  listMetrcPackagesForCompany: listPackagesMock,
  listMetrcPackageRequestLogs: listLogsMock,
}));

vi.mock("./metrcEvaluationCreatedPackages.js", async () => {
  const actual = await vi.importActual<typeof import("./metrcEvaluationCreatedPackages.js")>(
    "./metrcEvaluationCreatedPackages.js",
  );
  return {
    ...actual,
    listEvaluationCreatedPackageRefs: listCreatedRefsMock,
  };
});

import {
  MetrcEvaluationPackageNotFoundError,
  resolveMetrcEvaluationPackage,
} from "./metrcPackageResolve.js";

describe("resolveMetrcEvaluationPackage", () => {
  beforeEach(() => {
    listPackagesMock.mockReset();
    listCreatedRefsMock.mockReset();
  });

  it("prefers newest evaluation-created package over older synced package", async () => {
    listCreatedRefsMock.mockResolvedValue([
      {
        packageLabel: "AAA00090000196B000000002",
        createdAt: new Date("2026-05-26T12:00:00.000Z"),
        createdViaTest: true,
      },
    ]);
    listPackagesMock.mockResolvedValue([
      {
        packageLabel: "AAA00090000196B000000001",
        licenseNumber: "SF-SBX-CO-7-13402",
        itemName: "Old",
        quantity: 5,
        unitOfMeasure: "Grams",
        rawPayloadJson: JSON.stringify({ Quantity: 5, IsFinished: false, IsOnHold: false }),
        lastSyncedAt: new Date("2026-05-20T12:00:00.000Z"),
      },
      {
        packageLabel: "AAA00090000196B000000002",
        licenseNumber: "SF-SBX-CO-7-13402",
        itemName: "New",
        quantity: 10,
        unitOfMeasure: "Grams",
        rawPayloadJson: JSON.stringify({ Id: 46901, Quantity: 10, IsFinished: false, IsOnHold: false }),
        lastSyncedAt: new Date("2026-05-26T12:00:00.000Z"),
      },
    ]);

    const pkg = await resolveMetrcEvaluationPackage({
      companyId: "c1",
      licenseNumber: "SF-SBX-CO-7-13402",
      packageLabel: "AAA00090000196B000000001",
      kind: "change_item",
    });

    expect(pkg.packageLabel).toBe("AAA00090000196B000000002");
    expect(pkg.selectedReason).toBe("newest_evaluation_created_package");
    expect(pkg.createdViaTest).toBe(true);
  });

  it("throws when no usable package exists", async () => {
    listCreatedRefsMock.mockResolvedValue([]);
    listPackagesMock.mockResolvedValue([]);

    await expect(
      resolveMetrcEvaluationPackage({
        companyId: "c1",
        licenseNumber: "SF-SBX-CO-7-13402",
        kind: "change_item",
      }),
    ).rejects.toBeInstanceOf(MetrcEvaluationPackageNotFoundError);
  });

  it("rejects kind=unfinish on the generic resolver", async () => {
    await expect(
      resolveMetrcEvaluationPackage({
        companyId: "c1",
        licenseNumber: "SF-SBX-CO-7-13402",
        kind: "unfinish",
      }),
    ).rejects.toThrow("resolveUnfinishPackageForEvaluation");
  });
});
