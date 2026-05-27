import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listPackagesMock,
  findPackageMock,
  listCreatedLabelsMock,
  fetchTagsMock,
} = vi.hoisted(() => ({
  listPackagesMock: vi.fn(),
  findPackageMock: vi.fn(),
  listCreatedLabelsMock: vi.fn(),
  fetchTagsMock: vi.fn(),
}));

vi.mock("../repositories/metrcPackageRepository.js", () => ({
  listMetrcPackagesForCompany: listPackagesMock,
  findMetrcPackageByLabel: findPackageMock,
}));

vi.mock("./metrcEvaluationCreatedPackages.js", () => ({
  listEvaluationCreatedPackageLabels: listCreatedLabelsMock,
}));

vi.mock("../services/metrcAvailablePackageTagsService.js", () => ({
  MetrcAvailablePackageTagsService: class {
    fetchLabels = fetchTagsMock;
  },
}));

import {
  incrementMetrcTag,
  MetrcPackageTagUnavailableError,
  pickLatestSandboxPackageLabel,
  selectSandboxPackageTag,
} from "./metrcPackageTagGenerator.js";

describe("incrementMetrcTag", () => {
  it("increments zero-padded METRC suffix", () => {
    expect(incrementMetrcTag("AAA00090000196B000000001")).toBe("AAA00090000196B000000002");
    expect(incrementMetrcTag("AAA00090000196B000000002")).toBe("AAA00090000196B000000003");
    expect(incrementMetrcTag("AAA00090000196B000000003")).toBe("AAA00090000196B000000004");
  });

  it("preserves prefix and padding width", () => {
    expect(incrementMetrcTag("PREFIX00099")).toBe("PREFIX00100");
  });
});

describe("pickLatestSandboxPackageLabel", () => {
  const rows = [
    {
      packageLabel: "AAA00090000196B000000001",
      licenseNumber: "SF-SBX-CO-7-13402",
      lastSyncedAt: new Date("2026-05-20T10:00:00Z"),
    },
    {
      packageLabel: "AAA00090000196B000000003",
      licenseNumber: "SF-SBX-CO-7-13402",
      lastSyncedAt: new Date("2026-05-26T12:00:00Z"),
    },
    {
      packageLabel: "AAA00090000196B000000002",
      licenseNumber: "SF-SBX-CO-7-13402",
      lastSyncedAt: new Date("2026-05-25T12:00:00Z"),
    },
  ];

  it("returns newest synced label for sandbox license", () => {
    expect(pickLatestSandboxPackageLabel(rows, "SF-SBX-CO-7-13402")).toBe(
      "AAA00090000196B000000003",
    );
  });
});

describe("selectSandboxPackageTag", () => {
  beforeEach(() => {
    listPackagesMock.mockReset();
    listCreatedLabelsMock.mockReset();
    fetchTagsMock.mockReset();
    listPackagesMock.mockResolvedValue([
      {
        packageLabel: "AAA00090000196B000000001",
        licenseNumber: "SF-SBX-CO-7-13402",
        lastSyncedAt: new Date(),
      },
      {
        packageLabel: "AAA00090000196B000000002",
        licenseNumber: "SF-SBX-CO-7-13402",
        lastSyncedAt: new Date(),
      },
    ]);
    listCreatedLabelsMock.mockResolvedValue(["AAA00090000196B000000002"]);
    fetchTagsMock.mockResolvedValue({
      ok: true,
      labels: [
        "AAA00090000196B000000001",
        "AAA00090000196B000000002",
        "AAA00090000196B000000004",
      ],
      parsedCount: 3,
      totalReturned: 3,
      licenseNumber: "SF-SBX-CO-7-13402",
      baseUrl: "https://sandbox-api-co.metrc.com",
      authMode: "sandbox_basic_vendor_user",
    });
  });

  it("selects first METRC-available tag not already used in NexBatch", async () => {
    const selected = await selectSandboxPackageTag({
      companyId: "c1",
      licenseNumber: "SF-SBX-CO-7-13402",
    });

    expect(selected.selectedPackageTag).toBe("AAA00090000196B000000004");
    expect(selected.tagSelectionSource).toBe("available_metrc_tags");
    expect(selected.availableTagCount).toBe(3);
    expect(selected.excludedUsedTags).toContain("AAA00090000196B000000001");
    expect(selected.excludedUsedTags).toContain("AAA00090000196B000000002");
  });

  it("throws when METRC has no unused available tags", async () => {
    fetchTagsMock.mockResolvedValue({
      ok: true,
      labels: ["AAA00090000196B000000001", "AAA00090000196B000000002"],
      parsedCount: 2,
      totalReturned: 2,
      licenseNumber: "SF-SBX-CO-7-13402",
      baseUrl: "https://sandbox-api-co.metrc.com",
      authMode: "sandbox_basic_vendor_user",
    });

    await expect(
      selectSandboxPackageTag({
        companyId: "c1",
        licenseNumber: "SF-SBX-CO-7-13402",
      }),
    ).rejects.toBeInstanceOf(MetrcPackageTagUnavailableError);
  });

  it("falls back to increment when tags endpoint is unavailable", async () => {
    fetchTagsMock.mockResolvedValue({
      ok: false,
      status: 404,
      message: "Not found",
      baseUrl: "https://sandbox-api-co.metrc.com",
      licenseNumber: "SF-SBX-CO-7-13402",
      attemptedModes: [],
      failures: [],
    });
    findPackageMock.mockResolvedValue(null);

    const selected = await selectSandboxPackageTag({
      companyId: "c1",
      licenseNumber: "SF-SBX-CO-7-13402",
    });

    expect(selected.tagSelectionSource).toBe("incremented_fallback");
    expect(selected.selectedPackageTag).toBe("AAA00090000196B000000003");
  });
});
