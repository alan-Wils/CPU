import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  loadConfigMock,
  getMock,
  fromLoadedConfigMock,
  upsertMock,
  upsertLocationsMock,
  listLocationsMock,
  applyAutoMappingsMock,
  configListMock,
} = vi.hoisted(() => ({
  loadConfigMock: vi.fn(),
  getMock: vi.fn(),
  fromLoadedConfigMock: vi.fn(),
  upsertMock: vi.fn(),
  upsertLocationsMock: vi.fn(),
  listLocationsMock: vi.fn(),
  applyAutoMappingsMock: vi.fn(),
  configListMock: vi.fn(),
}));

vi.mock("../lib/metrcConfigLoader.js", () => ({
  loadCompanyMetrcConfig: loadConfigMock,
}));

vi.mock("./configService.js", () => ({
  ConfigService: class {
    upsert = upsertMock;
    list = configListMock;
  },
}));

vi.mock("../repositories/metrcLocationRepository.js", () => ({
  upsertMetrcLocationsForCompany: upsertLocationsMock,
  listMetrcLocationsForCompany: listLocationsMock,
  applyAutoMetrcLocationMappings: applyAutoMappingsMock,
  updateMetrcLocationMapping: vi.fn(),
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

import { MetrcLocationsSyncService } from "./metrcLocationsSyncService.js";

const loaded = {
  company: { metrc: {}, cultivation: { rooms: { vegRooms: [{ id: "veg-1", name: "Veg A", bays: [] }], flowerRooms: [] } } },
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

describe("MetrcLocationsSyncService", () => {
  beforeEach(() => {
    loadConfigMock.mockReset();
    getMock.mockReset();
    fromLoadedConfigMock.mockReset();
    upsertMock.mockReset();
    upsertLocationsMock.mockReset();
    listLocationsMock.mockReset();
    configListMock.mockReset();
    loadConfigMock.mockResolvedValue(loaded);
    fromLoadedConfigMock.mockImplementation(() => ({
      baseUrl: "https://sandbox-api-co.metrc.com",
      get: getMock,
    }));
    upsertMock.mockResolvedValue({});
    upsertLocationsMock.mockResolvedValue(1);
    applyAutoMappingsMock.mockResolvedValue(0);
    configListMock.mockResolvedValue([{ key: "company", value: loaded.company }]);
    getMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/facilities/")) {
        return {
          ok: true,
          status: 200,
          data: { Data: [{ LicenseNumber: "SF-SBX-CO-1-13402", StartDate: "2026-01-01" }] },
          durationMs: 5,
          retries: 0,
          rateLimitWaitedMs: 0,
          authMode: "sandbox_basic_vendor_user",
          metrcMessage: "OK",
        };
      }
      return {
        ok: true,
        status: 200,
        data: {
          Data: [
            {
              Id: 1,
              Name: "Room A",
              LocationTypeId: 2,
              LocationTypeName: "Default",
              ForPlants: true,
              ForHarvests: false,
              ForPackages: false,
            },
          ],
        },
        durationMs: 8,
        retries: 0,
        rateLimitWaitedMs: 0,
        authMode: "sandbox_basic_vendor_user",
        metrcMessage: "OK",
      };
    });
    listLocationsMock.mockResolvedValue([
      {
        metrcLocationId: "1",
        licenseNumber: "SF-SBX-CO-1-13402",
        name: "Room A",
        locationTypeId: 2,
        locationTypeName: "Default",
        forPlants: true,
        forHarvests: false,
        forPackages: false,
        nexbatchRoomSuite: null,
        nexbatchRoomId: null,
        nexbatchMappingManual: false,
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("syncs locations and treats zero rows as success", async () => {
    getMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/facilities/")) {
        return {
          ok: true,
          status: 200,
          data: { Data: [{ LicenseNumber: "SF-SBX-CO-1-13402", StartDate: "2026-01-01" }] },
          durationMs: 5,
          retries: 0,
          rateLimitWaitedMs: 0,
          authMode: "sandbox_basic_vendor_user",
          metrcMessage: "OK",
        };
      }
      return {
        ok: true,
        status: 200,
        data: { Data: [] },
        durationMs: 8,
        retries: 0,
        rateLimitWaitedMs: 0,
        authMode: "sandbox_basic_vendor_user",
        metrcMessage: "OK",
      };
    });
    listLocationsMock.mockResolvedValue([]);

    const svc = new MetrcLocationsSyncService();
    const out = await svc.syncMetrcLocations({ companyId: "c1", actorUserId: "u1" });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.count).toBe(0);
    expect(out.totalLocationsSynced).toBe(0);
    expect(out.locations).toEqual([]);
  });

  it("persists locations and sync metadata", async () => {
    const svc = new MetrcLocationsSyncService();
    const out = await svc.syncMetrcLocations({ companyId: "c1", actorUserId: "u1" });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.locations[0]?.metrcLocationId).toBe("1");
    expect(out.locations[0]?.forPlants).toBe(true);
    expect(upsertLocationsMock).toHaveBeenCalled();
    const savedMetrc = (upsertMock.mock.calls.at(-1)?.[0] as { value?: { metrc?: Record<string, unknown> } })
      ?.value?.metrc;
    expect(savedMetrc?.metrcLastLocationsSyncAt).toBeTruthy();
    expect(savedMetrc?.metrcTotalLocationsSynced).toBe(1);
  });

  it("fetches sequential pages and dedupes by METRC Id", async () => {
    getMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/facilities/")) {
        return {
          ok: true,
          status: 200,
          data: { Data: [{ LicenseNumber: "SF-SBX-CO-1-13402", StartDate: "2026-01-01" }] },
          durationMs: 5,
          retries: 0,
          rateLimitWaitedMs: 0,
          authMode: "sandbox_basic_vendor_user",
          metrcMessage: "OK",
        };
      }
      const pageNumber = Number(new URLSearchParams(String(path).split("?")[1] ?? "").get("pageNumber") || "1");
      if (pageNumber === 1) {
        return {
          ok: true,
          status: 200,
          data: {
            Data: Array.from({ length: 20 }, (_, i) => ({
              Id: i + 1,
              Name: `Room ${i + 1}`,
              ForPlants: true,
            })),
            TotalRecords: 21,
            TotalPages: 2,
            PageSize: 20,
            Page: 1,
          },
          durationMs: 8,
          retries: 0,
          rateLimitWaitedMs: 0,
          authMode: "sandbox_basic_vendor_user",
          metrcMessage: "OK",
        };
      }
      return {
        ok: true,
        status: 200,
        data: {
          Data: [
            { Id: 20, Name: "Room 20 updated", ForPlants: true },
            { Id: 21, Name: "Room 21", ForPlants: true },
          ],
          TotalRecords: 21,
          TotalPages: 2,
          PageSize: 20,
          Page: 2,
        },
        durationMs: 8,
        retries: 0,
        rateLimitWaitedMs: 0,
        authMode: "sandbox_basic_vendor_user",
        metrcMessage: "OK",
      };
    });
    listLocationsMock.mockResolvedValue(
      Array.from({ length: 21 }, (_, i) => ({
        metrcLocationId: String(i + 1),
        licenseNumber: "SF-SBX-CO-1-13402",
        name: i === 19 ? "Room 20 updated" : `Room ${i + 1}`,
        locationTypeId: null,
        locationTypeName: "",
        forPlants: true,
        forHarvests: false,
        forPackages: false,
        nexbatchRoomSuite: null,
        nexbatchRoomId: null,
        nexbatchMappingManual: false,
      })),
    );

    const svc = new MetrcLocationsSyncService();
    const out = await svc.syncMetrcLocations({ companyId: "c1", actorUserId: "u1" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.count).toBe(21);
    const locationGets = getMock.mock.calls.filter((c) => String(c[0] ?? "").includes("/locations/v2/active"));
    expect(locationGets.length).toBeGreaterThanOrEqual(2);
    const upserted = upsertLocationsMock.mock.calls[0]?.[1] as Array<{ metrcLocationId: string; name: string }>;
    expect(upserted).toHaveLength(21);
    expect(upserted.find((r) => r.metrcLocationId === "20")?.name).toBe("Room 20 updated");
  });
});
