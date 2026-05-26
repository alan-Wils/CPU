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
    expect(out.userKeyLength).toBeGreaterThan(40);
    expect(getMock).toHaveBeenCalled();
    const locationsCall = getMock.mock.calls.find((c) =>
      String(c[0] ?? "").includes("/locations/v2/active"),
    );
    const path = String(locationsCall?.[0] ?? "");
    expect(path).toContain("/locations/v2/active");
    expect(path).toContain("licenseNumber=SF-SBX-CO-1-13402");
    expect(path).toContain("lastModifiedStart=");
    expect(path).toContain("pageSize=20");
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
});
