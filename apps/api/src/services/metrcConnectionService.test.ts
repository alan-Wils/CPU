import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listMock, upsertMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  upsertMock: vi.fn(),
}));

vi.mock("./configService.js", () => ({
  ConfigService: class {
    list = listMock;
    upsert = upsertMock;
  },
}));

import { MetrcConnectionService } from "./metrcConnectionService.js";

function companyRow(metrc: Record<string, unknown>) {
  return [{ key: "company", value: { metrc, settings: {} } }];
}

const baseMetrc = {
  stateCode: "CO",
  environment: "production",
  apiBaseUrlOverride: "",
  licenseNumber: "LIC-1",
  apiKey: "",
  userKey: "user-only",
};

describe("MetrcConnectionService", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    listMock.mockReset();
    upsertMock.mockReset();
    upsertMock.mockResolvedValue({});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls METRC with Bearer when only user key is set", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ Data: [{ Id: 1, Name: "Loc" }] }),
    });
    globalThis.fetch = fetchMock as typeof fetch;

    listMock.mockResolvedValue(companyRow({ ...baseMetrc, apiKey: "", userKey: "UKEY" }));

    const svc = new MetrcConnectionService();
    const out = await svc.runTestConnection({ companyId: "c1", actorUserId: "u1" });

    expect(out.ok && out.connected).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      Authorization: "Bearer UKEY",
    });
  });

  it("calls METRC with Basic when vendor and user keys are set", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "[]",
    });
    globalThis.fetch = fetchMock as typeof fetch;

    listMock.mockResolvedValue(
      companyRow({
        ...baseMetrc,
        apiKey: "VENDOR",
        userKey: "USER",
      }),
    );

    const svc = new MetrcConnectionService();
    await svc.runTestConnection({ companyId: "c1", actorUserId: "u1" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(auth.startsWith("Basic ")).toBe(true);
    expect(Buffer.from(auth.slice(6), "base64").toString("utf8")).toBe("VENDOR:USER");
  });

  it("returns not_connected when METRC responds 401", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "{}",
    });
    globalThis.fetch = fetchMock as typeof fetch;

    listMock.mockResolvedValue(companyRow({ ...baseMetrc, apiKey: "V", userKey: "bad" }));

    const svc = new MetrcConnectionService();
    const out = await svc.runTestConnection({ companyId: "c1", actorUserId: "u1" });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.connected).toBe(false);
    expect(out.status).toBe(401);
    expect(out.message).toMatch(/authentication failed/i);
  });
});
