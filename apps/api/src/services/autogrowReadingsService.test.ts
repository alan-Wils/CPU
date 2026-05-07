import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listMock = vi.fn();

vi.mock("./configService.js", () => ({
  ConfigService: class {
    list = listMock;
  },
}));

import { AutogrowReadingsService } from "./autogrowReadingsService.js";

function companyClimate(ag: Record<string, unknown>) {
  return [{ key: "company", value: { climateControl: { autogrow: ag }, settings: {} } }];
}

describe("AutogrowReadingsService", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    listMock.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("getSnapshot fails when integration is disabled", async () => {
    listMock.mockResolvedValue(
      companyClimate({ apiKey: "k", deviceUuid: "u", integrationEnabled: false, compLabels: [] }),
    );
    const svc = new AutogrowReadingsService();
    const out = await svc.getSnapshot("c1");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.status).toBe(403);
  });

  it("getCompReadings returns readings and sends Bearer token", async () => {
    listMock.mockResolvedValue(
      companyClimate({
        apiKey: "SECRET",
        deviceUuid: "dev-1",
        integrationEnabled: true,
        compLabels: [{ compIndex: 0, label: "Room A" }],
      }),
    );
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () =>
        JSON.stringify({
          metadata: { name: "c0" },
          readings: { air_temp: 22.5, rh: 55 },
        }),
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const svc = new AutogrowReadingsService();
    const out = await svc.getCompReadings("c1", 0);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.readings.air_temp).toBe(22.5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/multigrow/dev-1/comps/0");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer SECRET");
  });

  it("getSnapshot attaches compLabels and stops compartment scan on first 404", async () => {
    listMock.mockResolvedValue(
      companyClimate({
        apiKey: "k",
        deviceUuid: "uuid-xyz",
        integrationEnabled: true,
        compLabels: [{ compIndex: 3, label: "Z3" }],
      }),
    );

    let n = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      n += 1;
      if (n === 1) {
        return {
          status: 200,
          text: async () =>
            JSON.stringify({
              readings: { air_temp_out: 18 },
              metadata: {},
            }),
        };
      }
      if (n === 2) {
        return {
          status: 404,
          text: async () => "not found",
        };
      }
      throw new Error(`unexpected fetch call ${n}`);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const svc = new AutogrowReadingsService();
    const out = await svc.getSnapshot("c1");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.compLabels).toEqual([{ compIndex: 3, label: "Z3" }]);
    expect(out.comps).toHaveLength(0);
    expect(out.weather.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("getCompReadings returns message on non-200", async () => {
    listMock.mockResolvedValue(
      companyClimate({
        apiKey: "k",
        deviceUuid: "d",
        integrationEnabled: true,
        compLabels: [],
      }),
    );
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 401,
      text: async () => "{}",
    }) as typeof fetch;

    const svc = new AutogrowReadingsService();
    const out = await svc.getCompReadings("c1", 2);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.status).toBe(401);
    expect(out.message).toMatch(/HTTP 401/);
  });
});
