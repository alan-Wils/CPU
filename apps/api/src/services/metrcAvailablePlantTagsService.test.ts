import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listMock = vi.fn();

vi.mock("./configService.js", () => ({
  ConfigService: class {
    list = listMock;
  },
}));

import { MetrcAvailablePlantTagsService } from "./metrcAvailablePlantTagsService.js";

function companyRow(metrc: Record<string, unknown>) {
  return [{ key: "company", value: { metrc, settings: {} } }];
}

const baseMetrc = {
  stateCode: "CO",
  environment: "production",
  apiBaseUrlOverride: "",
  licenseNumber: "123-ABC",
  apiKey: "",
  userKey: "USERKEY",
};

describe("MetrcAvailablePlantTagsService", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    listMock.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns trimmed labels on success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify([
          { Label: "ABCDEF012345670000010001", Id: 1 },
          { Label: "ABCDEF012345670000010002", Id: 2 },
        ]),
    }) as typeof fetch;

    listMock.mockResolvedValue(companyRow({ ...baseMetrc, userKey: "UKEY" }));

    const svc = new MetrcAvailablePlantTagsService();
    const out = await svc.fetchLabels({ companyId: "c1", limit: 10 });

    expect(out.ok && out.ok === true).toBe(true);
    if (!out.ok) return;
    expect(out.labels).toEqual(["ABCDEF012345670000010001", "ABCDEF012345670000010002"]);
    expect(out.parsedCount).toBe(2);
    const callUrl = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
    expect(String(callUrl)).toContain("/tags/v2/plant/available?");
    expect(String(callUrl)).toContain(encodeURIComponent("123-ABC"));
  });

  it("fails fast when license missing", async () => {
    listMock.mockResolvedValue(
      companyRow({
        ...baseMetrc,
        licenseNumber: "",
        userKey: "U",
      }),
    );
    const svc = new MetrcAvailablePlantTagsService();
    const out = await svc.fetchLabels({ companyId: "c1", limit: 10 });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.status).toBe(400);
  });
});
