import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listMock, upsertMock, getMock, fromLoadedConfigMock, loadConfigMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  upsertMock: vi.fn(),
  getMock: vi.fn(),
  fromLoadedConfigMock: vi.fn(),
  loadConfigMock: vi.fn(),
}));

vi.mock("./configService.js", () => ({
  ConfigService: class {
    list = listMock;
    upsert = upsertMock;
  },
}));

vi.mock("../lib/metrcConfigLoader.js", () => ({
  loadCompanyMetrcConfig: loadConfigMock,
}));

vi.mock("../lib/metrcClient.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/metrcClient.js")>("../lib/metrcClient.js");
  return {
    ...actual,
    MetrcClient: class {
      baseUrl = "https://sandbox-api-co.metrc.com";
      get = getMock;
      static fromLoadedConfig = fromLoadedConfigMock;
    },
  };
});

import { MetrcConnectionService } from "./metrcConnectionService.js";

const loaded = {
  company: { metrc: {} },
  metrc: {},
  vendorApiKey: "VENDORKEY",
  userApiKey: "USERKEY1234567890123456789012345678901234567890",
  username: "user",
  licenseNumber: "LIC-1",
  facilityName: "Test",
  stateCode: "CO",
  environment: "sandbox" as const,
  apiBaseUrlOverride: "",
};

describe("MetrcConnectionService", () => {
  beforeEach(() => {
    listMock.mockReset();
    upsertMock.mockResolvedValue({});
    getMock.mockReset();
    fromLoadedConfigMock.mockImplementation(() => ({
      baseUrl: "https://sandbox-api-co.metrc.com",
      get: getMock,
    }));
    loadConfigMock.mockResolvedValue(loaded);
  });

  it("succeeds via MetrcClient (same auth as pull)", async () => {
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
        data: { Data: [{ Id: 1, Name: "Room A" }] },
        durationMs: 10,
        retries: 0,
        rateLimitWaitedMs: 0,
        authMode: "sandbox_basic_vendor_user",
        metrcMessage: "OK",
      };
    });

    const svc = new MetrcConnectionService();
    const out = await svc.runTestConnection({ companyId: "c1", actorUserId: "u1" });

    expect(out.ok && out.connected).toBe(true);
    if (!out.ok || !out.connected) return;
    expect(out.authMode).toBe("sandbox_basic_vendor_user");
    expect(out.licenseNumber).toBe("SF-SBX-CO-1-13402");
    expect(out.diagnostics.operationalAccessGranted).toBe(true);
    expect(out.diagnostics.provisioningComplete).toBe(true);
    expect(out.diagnostics.sandboxStatus).toBe("connected");
    expect(out.userKeyLength).toBeGreaterThan(40);
    expect(upsertMock).toHaveBeenCalled();
    const savedMetrc = (upsertMock.mock.calls.at(-1)?.[0] as { value?: { metrc?: Record<string, unknown> } })
      ?.value?.metrc;
    expect(savedMetrc?.sandboxReady).toBe(true);
    expect(savedMetrc?.metrcOperationalAccessGranted).toBe(true);
    expect(savedMetrc?.licenseNumber).toBe("SF-SBX-CO-1-13402");
    expect(getMock).toHaveBeenCalled();
    const locationsCall = getMock.mock.calls.find((c) =>
      String(c[0] ?? "").includes("/locations/v2/active"),
    );
    const path = String(locationsCall?.[0] ?? "");
    expect(path).toContain("/locations/v2/active");
    expect(path).toContain("licenseNumber=SF-SBX-CO-1-13402");
    expect(path).toContain("pageNumber=1");
    expect(path).toContain("pageSize=20");
    expect(path).not.toContain("lastModifiedStart=");
    expect(path).not.toContain("lastModifiedEnd=");
    expect(out.locationCount).toBe(1);
  });

  it("returns credential hint when all auth modes fail", async () => {
    getMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/facilities/")) {
        return {
          ok: true,
          status: 200,
          data: { Data: [{ LicenseNumber: "SF-SBX-CO-1-13402" }] },
          durationMs: 5,
          retries: 0,
          rateLimitWaitedMs: 0,
          authMode: "sandbox_basic_vendor_user",
          metrcMessage: "OK",
        };
      }
      return {
        ok: false,
        status: 401,
        message: "Authorization has been denied for this request.",
        durationMs: 5,
        retries: 0,
        rateLimitWaitedMs: 0,
        metrcMessage: "Authorization has been denied for this request.",
        attemptedAuthModes: ["sandbox_basic_vendor_user"],
        authAttempts: [
          { mode: "sandbox_basic_vendor_user", status: 401, durationMs: 12, metrcMessage: "denied" },
        ],
      };
    });

    const svc = new MetrcConnectionService();
    const out = await svc.runTestConnection({ companyId: "c1", actorUserId: "u1" });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.credentialHint).toContain("METRC denied operational access");
    expect(out.userKeyLength).toBeGreaterThan(40);
    expect(out.attemptedModes).toContain("sandbox_basic_vendor_user");
    expect(out.diagnostics.sandboxStatus).toBeDefined();
  });

  function locationsOk(data: unknown) {
    return {
      ok: true as const,
      status: 200,
      data,
      durationMs: 8,
      retries: 0,
      rateLimitWaitedMs: 0,
      authMode: "sandbox_basic_vendor_user" as const,
      metrcMessage: "OK",
    };
  }

  function facilitiesOk(licenseNumber: string) {
    return locationsOk({ Data: [{ LicenseNumber: licenseNumber, StartDate: "2020-01-01" }] });
  }

  it("reports TotalRecords from a PascalCase paginated production payload", async () => {
    const licenseNumber = "403R-00930";
    loadConfigMock.mockResolvedValue({ ...loaded, licenseNumber, environment: "production" });
    const dataRows = Array.from({ length: 14 }, (_, i) => ({ Id: i + 1, Name: `Room ${i + 1}` }));
    getMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/facilities/")) return facilitiesOk(licenseNumber);
      return locationsOk({
        Data: dataRows,
        Total: 14,
        TotalRecords: 14,
        PageSize: 20,
        RecordsOnPage: 14,
        Page: 1,
        CurrentPage: 1,
        TotalPages: 1,
      });
    });

    const svc = new MetrcConnectionService();
    const out = await svc.runTestConnection({ companyId: "c1", actorUserId: "u1" });
    expect(out.ok && out.connected).toBe(true);
    if (!out.ok || !out.connected) return;
    expect(out.locationCount).toBe(14);
    expect(out.licenseNumber).toBe(licenseNumber);
    const path = String(
      getMock.mock.calls.find((c) => String(c[0] ?? "").includes("/locations/v2/active"))?.[0] ?? "",
    );
    expect(path).toBe(`/locations/v2/active?licenseNumber=${licenseNumber}&pageNumber=1&pageSize=20`);
  });

  it("reports lowercase data array totals", async () => {
    getMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/facilities/")) return facilitiesOk("SF-SBX-CO-1-13402");
      return locationsOk({ data: [{ Id: 1, Name: "A" }, { id: 2, Name: "B" }], totalRecords: 2 });
    });
    const out = await new MetrcConnectionService().runTestConnection({
      companyId: "c1",
      actorUserId: "u1",
    });
    expect(out.ok && "locationCount" in out ? out.locationCount : 0).toBe(2);
  });

  it("reports empty paginated totals as zero", async () => {
    getMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/facilities/")) return facilitiesOk("SF-SBX-CO-1-13402");
      return locationsOk({
        Data: [],
        Total: 0,
        TotalRecords: 0,
        PageSize: 20,
        RecordsOnPage: 0,
        Page: 1,
        CurrentPage: 1,
        TotalPages: 1,
      });
    });
    const out = await new MetrcConnectionService().runTestConnection({
      companyId: "c1",
      actorUserId: "u1",
    });
    expect(out.ok && out.connected).toBe(true);
    if (!out.ok || !out.connected) return;
    expect(out.locationCount).toBe(0);
  });

  it("treats a malformed locations body as zero locations", async () => {
    getMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/facilities/")) return facilitiesOk("SF-SBX-CO-1-13402");
      return locationsOk("not-json-array");
    });
    const out = await new MetrcConnectionService().runTestConnection({
      companyId: "c1",
      actorUserId: "u1",
    });
    expect(out.ok && out.connected).toBe(true);
    if (!out.ok || !out.connected) return;
    expect(out.locationCount).toBe(0);
  });

  it("prefers TotalRecords when Data is empty", async () => {
    getMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/facilities/")) return facilitiesOk("SF-SBX-CO-1-13402");
      return locationsOk({ Data: [], TotalRecords: 14, Total: 0 });
    });
    const out = await new MetrcConnectionService().runTestConnection({
      companyId: "c1",
      actorUserId: "u1",
    });
    expect(out.ok && "locationCount" in out ? out.locationCount : 0).toBe(14);
  });
});
