import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  loadConfigMock,
  getMock,
  fromLoadedConfigMock,
  upsertMock,
  upsertPackagesMock,
  listPackagesMock,
  findPackageByLabelMock,
  readPersistedInventoryMock,
  cultivationFindManyMock,
  resolveLocationsRequestMock,
} = vi.hoisted(() => ({
  loadConfigMock: vi.fn(),
  getMock: vi.fn(),
  fromLoadedConfigMock: vi.fn(),
  upsertMock: vi.fn(),
  upsertPackagesMock: vi.fn(),
  listPackagesMock: vi.fn(),
  findPackageByLabelMock: vi.fn(),
  readPersistedInventoryMock: vi.fn(),
  cultivationFindManyMock: vi.fn(),
  resolveLocationsRequestMock: vi.fn(),
}));

vi.mock("../lib/metrcConfigLoader.js", () => ({
  loadCompanyMetrcConfig: loadConfigMock,
}));

vi.mock("./configService.js", () => ({
  ConfigService: class {
    upsert = upsertMock;
  },
}));

vi.mock("../repositories/metrcPackageRepository.js", () => ({
  upsertMetrcPackagesForCompany: upsertPackagesMock,
  listMetrcPackagesForCompany: listPackagesMock,
  findMetrcPackageByLabel: findPackageByLabelMock,
}));

vi.mock("../lib/metrcLocationsActiveQuery.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/metrcLocationsActiveQuery.js")>();
  return {
    ...actual,
    resolveMetrcLocationsActiveRequest: resolveLocationsRequestMock,
  };
});

vi.mock("./leaflinkService.js", () => ({
  LeafLinkInventoryService: class {
    readPersistedInventory = readPersistedInventoryMock;
  },
}));

vi.mock("../config/prisma.js", () => ({
  prisma: {
    cultivationExtractionTransfer: {
      findMany: cultivationFindManyMock,
    },
  },
}));

vi.mock("../lib/metrcClient.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/metrcClient.js")>(
    "../lib/metrcClient.js",
  );
  return {
    ...actual,
    MetrcClient: class {
      baseUrl = "https://sandbox-api-co.metrc.com";
      get = getMock;
      static fromLoadedConfig = fromLoadedConfigMock;
    },
  };
});

import { MetrcPackagesSyncService } from "./metrcPackagesSyncService.js";

const loaded = {
  company: { metrc: {} },
  metrc: {},
  vendorApiKey: "VENDORKEY",
  userApiKey: "USERKEY1234567890123456789012345678901234567890",
  username: "user",
  licenseNumber: "SF-SBX-CO-1-13402",
  facilityName: "",
  stateCode: "CO",
  environment: "sandbox" as const,
  apiBaseUrlOverride: "",
};

describe("MetrcPackagesSyncService", () => {
  beforeEach(() => {
    loadConfigMock.mockReset();
    getMock.mockReset();
    fromLoadedConfigMock.mockReset();
    upsertMock.mockReset();
    upsertPackagesMock.mockReset();
    listPackagesMock.mockReset();
    findPackageByLabelMock.mockReset();
    readPersistedInventoryMock.mockReset();
    cultivationFindManyMock.mockReset();
    resolveLocationsRequestMock.mockReset();
    loadConfigMock.mockResolvedValue(loaded);
    fromLoadedConfigMock.mockImplementation(() => ({
      baseUrl: "https://sandbox-api-co.metrc.com",
      get: getMock,
    }));
    upsertMock.mockResolvedValue({});
    upsertPackagesMock.mockResolvedValue(0);
    readPersistedInventoryMock.mockResolvedValue({ items: [], lastSyncedAt: "" });
    cultivationFindManyMock.mockResolvedValue([]);
    listPackagesMock.mockResolvedValue([]);
    findPackageByLabelMock.mockResolvedValue(null);
    resolveLocationsRequestMock.mockResolvedValue({
      pathnameAndQuery:
        "/packages/v2/active?licenseNumber=SF-SBX-CO-1-13402&lastModifiedStart=2026-01-01&lastModifiedEnd=2026-05-26&pageNumber=1&pageSize=20",
      params: {
        licenseNumber: "SF-SBX-CO-1-13402",
        lastModifiedStart: "2026-01-01",
        lastModifiedEnd: "2026-05-26",
        pageNumber: 1,
        pageSize: 20,
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("syncs packages and treats zero rows as success", async () => {
    getMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: { Data: [] },
      durationMs: 5,
      retries: 0,
      rateLimitWaitedMs: 0,
      authMode: "sandbox_basic_vendor_user",
      metrcMessage: "OK",
    });

    const svc = new MetrcPackagesSyncService();
    const res = await svc.syncMetrcPackages({ companyId: "c1", actorUserId: "u1" });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.count).toBe(0);
      expect(res.packages).toEqual([]);
      expect(res.syncDiagnostics.filteredPackageCount).toBe(0);
    }
    expect(upsertPackagesMock).toHaveBeenCalledWith("c1", []);
  });

  it("persists parsed packages", async () => {
    const syncedAt = new Date("2026-05-26T12:00:00.000Z");
    getMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        Data: [
          {
            Label: "PKG-1",
            Item: { Name: "Wax", StrainName: "Guava" },
            Quantity: 100,
            UnitOfMeasureName: "Grams",
            LocationName: "Vault",
          },
        ],
      },
      durationMs: 8,
      retries: 0,
      rateLimitWaitedMs: 0,
      authMode: "sandbox_basic_vendor_user",
      metrcMessage: "OK",
    });
    listPackagesMock.mockResolvedValue([
      {
        packageLabel: "PKG-1",
        licenseNumber: "SF-SBX-CO-1-13402",
        itemName: "Wax",
        quantity: 100,
        unitOfMeasure: "Grams",
        location: "Vault",
        productionBatchNumber: "",
        sourceHarvestNames: "",
        packagedDate: null,
        expirationDate: null,
        strainName: "Guava",
        lastSyncedAt: syncedAt,
      },
    ]);

    const svc = new MetrcPackagesSyncService();
    const res = await svc.syncMetrcPackages({ companyId: "c1", actorUserId: "u1" });

    expect(res.ok).toBe(true);
    expect(upsertPackagesMock).toHaveBeenCalledTimes(1);
    const rows = upsertPackagesMock.mock.calls[0]![1] as Array<{ packageLabel: string }>;
    expect(rows[0]?.packageLabel).toBe("PKG-1");
    if (res.ok) {
      expect(res.syncDiagnostics.returnedLabels).toContain("PKG-1");
    }
  });
});
