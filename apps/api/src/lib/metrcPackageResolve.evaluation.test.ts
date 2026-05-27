import { beforeEach, describe, expect, it, vi } from "vitest";

const { listPackagesMock, listLogsMock, listCreatedRefsMock, listFinishedLabelsMock } =
  vi.hoisted(() => ({
    listPackagesMock: vi.fn(),
    listLogsMock: vi.fn(),
    listCreatedRefsMock: vi.fn(),
    listFinishedLabelsMock: vi.fn(),
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

vi.mock("./metrcEvaluationFinishedPackages.js", () => ({
  listEvaluationFinishedPackageLabels: listFinishedLabelsMock,
}));

import {
  MetrcEvaluationPackageNotFoundError,
  resolveMetrcEvaluationPackage,
} from "./metrcPackageResolve.js";

describe("resolveMetrcEvaluationPackage", () => {
  beforeEach(() => {
    listPackagesMock.mockReset();
    listCreatedRefsMock.mockReset();
    listFinishedLabelsMock.mockReset();
    listFinishedLabelsMock.mockResolvedValue(new Set());
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

  it("selects newest finished evaluation-created package for unfinish", async () => {
    listCreatedRefsMock.mockResolvedValue([
      {
        packageLabel: "AAA00090000196B000000005",
        createdAt: new Date("2026-05-27T12:00:00.000Z"),
        createdViaTest: true,
      },
    ]);
    listFinishedLabelsMock.mockResolvedValue(new Set(["AAA00090000196B000000005"]));
    listPackagesMock.mockResolvedValue([
      {
        packageLabel: "AAA00090000196B000000005",
        licenseNumber: "SF-SBX-CO-7-13402",
        itemName: "Eval Item",
        quantity: 0,
        unitOfMeasure: "Grams",
        rawPayloadJson: JSON.stringify({
          Id: 46901,
          Quantity: 0,
          IsFinished: false,
          IsOnHold: false,
        }),
        lastSyncedAt: new Date("2026-05-27T12:00:00.000Z"),
      },
    ]);

    const pkg = await resolveMetrcEvaluationPackage({
      companyId: "c1",
      licenseNumber: "SF-SBX-CO-7-13402",
      kind: "unfinish",
    });

    expect(pkg.packageLabel).toBe("AAA00090000196B000000005");
    expect(pkg.selectedReason).toBe("newest_finished_evaluation_created_package");
    expect(pkg.isFinished).toBe(true);
  });

  it("throws unfinish-specific error when no finished evaluation package exists", async () => {
    listCreatedRefsMock.mockResolvedValue([
      {
        packageLabel: "AAA00090000196B000000005",
        createdAt: new Date("2026-05-27T12:00:00.000Z"),
        createdViaTest: true,
      },
    ]);
    listFinishedLabelsMock.mockResolvedValue(new Set());
    listPackagesMock.mockResolvedValue([
      {
        packageLabel: "AAA00090000196B000000005",
        licenseNumber: "SF-SBX-CO-7-13402",
        itemName: "Eval Item",
        quantity: 10,
        unitOfMeasure: "Grams",
        rawPayloadJson: JSON.stringify({ Quantity: 10, IsFinished: false }),
        lastSyncedAt: new Date("2026-05-27T12:00:00.000Z"),
      },
    ]);

    await expect(
      resolveMetrcEvaluationPackage({
        companyId: "c1",
        licenseNumber: "SF-SBX-CO-7-13402",
        kind: "unfinish",
      }),
    ).rejects.toThrow("No finished evaluation package found. Run Finish Package first.");
  });
});
