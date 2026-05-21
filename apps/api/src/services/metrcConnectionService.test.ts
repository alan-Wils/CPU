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
  userKey: "USERKEY",
};

describe("MetrcConnectionService diagnostics", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    listMock.mockReset();
    upsertMock.mockResolvedValue({});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("user-key-only: succeeds on first mode (Bearer) with one fetch", async () => {
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
    if (!out.ok || !out.connected) return;
    expect(out.authMode).toBe("bearer_user");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer UKEY");
  });

  it("user-key-only: tries all three modes when each fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "{}",
    });
    globalThis.fetch = fetchMock as typeof fetch;

    listMock.mockResolvedValue(companyRow({ ...baseMetrc, apiKey: "", userKey: "U" }));

    const svc = new MetrcConnectionService();
    const out = await svc.runTestConnection({ companyId: "c1", actorUserId: "u1" });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.failures).toHaveLength(3);
    expect(out.attemptedModes).toEqual(["bearer_user", "basic_user_colon", "basic_colon_user"]);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("vendor+user: tries dual-key first then fallbacks until success", async () => {
    let n = 0;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      n += 1;
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? "";
      if (n === 1) {
        expect(auth.startsWith("Basic ")).toBe(true);
        return { ok: false, status: 401, text: async () => "{}" };
      }
      expect(auth.startsWith("Bearer ")).toBe(true);
      return { ok: true, status: 200, text: async () => "[]" };
    });
    globalThis.fetch = fetchMock as typeof fetch;

    listMock.mockResolvedValue(
      companyRow({
        ...baseMetrc,
        apiKey: "VEND",
        userKey: "USR",
      }),
    );

    const svc = new MetrcConnectionService();
    const out = await svc.runTestConnection({ companyId: "c1", actorUserId: "u1" });

    expect(out.ok && out.connected).toBe(true);
    if (!out.ok || !out.connected) return;
    expect(out.authMode).toBe("bearer_user");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns failures with timing and modes when all modes fail", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"Message":"bad"}',
    });
    globalThis.fetch = fetchMock as typeof fetch;

    listMock.mockResolvedValue(companyRow({ ...baseMetrc, apiKey: "V", userKey: "U" }));

    const svc = new MetrcConnectionService();
    const out = await svc.runTestConnection({ companyId: "c1", actorUserId: "u1" });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.failures.length).toBe(4);
    expect(out.failures[0].mode).toBe("dual_key_basic");
    expect(out.failures[0].metrcSnippet).toBe("bad");
    expect(typeof out.failures[0].durationMs).toBe("number");
    expect(out.message).toContain("dual_key_basic");
  });
});
