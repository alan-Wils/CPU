import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  loadConfigMock,
  getMock,
  fromLoadedConfigMock,
  upsertMock,
  upsertStrainsMock,
  listStrainsMock,
  configListMock,
} = vi.hoisted(() => ({
  loadConfigMock: vi.fn(),
  getMock: vi.fn(),
  fromLoadedConfigMock: vi.fn(),
  upsertMock: vi.fn(),
  upsertStrainsMock: vi.fn(),
  listStrainsMock: vi.fn(),
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

vi.mock("../repositories/metrcStrainRepository.js", () => ({
  upsertMetrcStrainsForCompany: upsertStrainsMock,
  listMetrcStrainsForCompany: listStrainsMock,
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

import { MetrcStrainsSyncService } from "./metrcStrainsSyncService.js";

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

describe("MetrcStrainsSyncService", () => {
  beforeEach(() => {
    loadConfigMock.mockReset();
    getMock.mockReset();
    fromLoadedConfigMock.mockReset();
    upsertMock.mockReset();
    upsertStrainsMock.mockReset();
    listStrainsMock.mockReset();
    configListMock.mockReset();
    loadConfigMock.mockResolvedValue(loaded);
    fromLoadedConfigMock.mockImplementation(() => ({
      baseUrl: "https://sandbox-api-co.metrc.com",
      get: getMock,
    }));
    upsertMock.mockResolvedValue({});
    upsertStrainsMock.mockResolvedValue(1);
    configListMock.mockResolvedValue([
      {
        key: "cultivation",
        value: {
          strains: [{ id: "strain-1", name: "Blue Dream", acronym: "BD", dominance: "", potency: "", averageYield: "" }],
        },
      },
    ]);
    getMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        Data: [
          {
            Id: 1,
            Name: "Blue Dream",
            TestingStatus: "None",
            IsActive: true,
            IsArchived: false,
            LastModified: "2026-05-26T10:00:00Z",
          },
        ],
      },
      durationMs: 8,
      retries: 0,
      rateLimitWaitedMs: 0,
      authMode: "sandbox_basic_vendor_user",
      metrcMessage: "OK",
    });
    listStrainsMock.mockResolvedValue([
      {
        metrcStrainId: "1",
        licenseNumber: "SF-SBX-CO-1-13402",
        name: "Blue Dream",
        testingStatus: "None",
        active: true,
        archived: false,
        lastModified: new Date("2026-05-26T10:00:00Z"),
        nexbatchStrainId: "strain-1",
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("syncs strains and treats zero rows as success", async () => {
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
    listStrainsMock.mockResolvedValue([]);

    const svc = new MetrcStrainsSyncService();
    const out = await svc.syncMetrcStrains({ companyId: "c1", actorUserId: "u1" });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.count).toBe(0);
    expect(out.strains).toEqual([]);
  });

  it("persists strains, links NexBatch by exact name, and updates METRC status", async () => {
    const svc = new MetrcStrainsSyncService();
    const out = await svc.syncMetrcStrains({ companyId: "c1", actorUserId: "u1" });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.strains[0]?.nexbatchStrainId).toBe("strain-1");
    expect(upsertStrainsMock).toHaveBeenCalled();
    const savedMetrc = (upsertMock.mock.calls.at(-1)?.[0] as { value?: { metrc?: Record<string, unknown> } })
      ?.value?.metrc;
    expect(savedMetrc?.metrcLastConnectionHttpStatus).toBe(200);
    expect(savedMetrc?.metrcLastMetrcResponseMessage).toBe("Synced 1 strain.");
  });
});
