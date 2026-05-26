import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loadConfigMock, getMock, fromLoadedConfigMock, upsertMock, upsertFacilitiesMock } =
  vi.hoisted(() => ({
    loadConfigMock: vi.fn(),
    getMock: vi.fn(),
    fromLoadedConfigMock: vi.fn(),
    upsertMock: vi.fn(),
    upsertFacilitiesMock: vi.fn(),
  }));

vi.mock("../lib/metrcConfigLoader.js", () => ({
  loadCompanyMetrcConfig: loadConfigMock,
}));

vi.mock("./configService.js", () => ({
  ConfigService: class {
    upsert = upsertMock;
  },
}));

vi.mock("../repositories/metrcFacilityRepository.js", () => ({
  upsertMetrcFacilitiesForCompany: upsertFacilitiesMock,
  listMetrcFacilitiesForCompany: vi.fn(),
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

import { METRC_FACILITIES_V2_PROCESSOR_ROW } from "../lib/metrcFacilitiesV2Fixture.js";
import { MetrcFacilitiesSyncService } from "./metrcFacilitiesSyncService.js";

const loaded = {
  company: { metrc: {} },
  metrc: { licenseNumber: "SBX-CO", facilityName: "" },
  vendorApiKey: "VENDORKEY",
  userApiKey: "USERKEY1234567890123456789012345678901234567890",
  username: "user",
  licenseNumber: "SBX-CO",
  facilityName: "",
  stateCode: "CO",
  environment: "sandbox" as const,
  apiBaseUrlOverride: "",
};

describe("MetrcFacilitiesSyncService", () => {
  beforeEach(() => {
    loadConfigMock.mockReset();
    getMock.mockReset();
    fromLoadedConfigMock.mockReset();
    upsertMock.mockReset();
    upsertFacilitiesMock.mockReset();
    loadConfigMock.mockResolvedValue(loaded);
    fromLoadedConfigMock.mockImplementation(() => ({
      baseUrl: "https://sandbox-api-co.metrc.com",
      get: getMock,
    }));
    upsertMock.mockResolvedValue({});
    upsertFacilitiesMock.mockResolvedValue(1);
    getMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        Data: [METRC_FACILITIES_V2_PROCESSOR_ROW],
      },
      durationMs: 12,
      retries: 0,
      rateLimitWaitedMs: 0,
      authMode: "sandbox_basic_vendor_user",
      metrcMessage: "OK",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("syncs facilities, persists DB rows, and updates company METRC status", async () => {
    const svc = new MetrcFacilitiesSyncService();
    const out = await svc.syncMetrcFacilities({ companyId: "c1", actorUserId: "u1" });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.count).toBe(1);
    expect(out.facilities[0]?.licenseNumber).toBe("SF-SBX-CO-1-13402");
    expect(out.facilities[0]?.facilityTypeName).toBe("Processor");
    expect(out.facilities[0]?.facilityName).toBe("SBX Centralized Processing Hub");
    expect(upsertFacilitiesMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalled();
    const savedMetrc = (upsertMock.mock.calls.at(-1)?.[0] as { value?: { metrc?: Record<string, unknown> } })
      ?.value?.metrc;
    expect(savedMetrc?.sandboxReady).toBe(true);
    expect(savedMetrc?.metrcOperationalAccessGranted).toBe(true);
    expect(savedMetrc?.metrcSandboxLastFacilitiesSyncAt).toBeTruthy();
    expect(savedMetrc?.licenseNumber).toBe("SF-SBX-CO-1-13402");
    expect(savedMetrc?.facilityName).toBe("SBX Centralized Processing Hub");
    expect(savedMetrc?.metrcLastConnectionHttpStatus).toBe(200);
  });
});
