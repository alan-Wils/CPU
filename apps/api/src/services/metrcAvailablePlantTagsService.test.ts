import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listMock, performGetMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  performGetMock: vi.fn(),
}));

vi.mock("./configService.js", () => ({
  ConfigService: class {
    list = listMock;
  },
}));

vi.mock("../lib/metrcPerformGet.js", () => ({
  performMetrcAuthorizedGet: performGetMock,
  isMetrcPerformGetFailure: (r: { ok: boolean }) => r.ok === false,
}));

import { MetrcAvailablePlantTagsService } from "./metrcAvailablePlantTagsService.js";

function companyRow(metrc: Record<string, unknown>) {
  return [{ key: "company", value: { metrc, settings: {} } }];
}

const baseMetrc = {
  stateCode: "CO",
  environment: "sandbox",
  apiBaseUrlOverride: "",
  licenseNumber: "123-ABC",
  userKey: "USERKEY",
};

describe("MetrcAvailablePlantTagsService", () => {
  beforeEach(() => {
    listMock.mockReset();
    performGetMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns trimmed labels on success", async () => {
    listMock.mockResolvedValue(companyRow(baseMetrc));
    performGetMock.mockResolvedValue({
      ok: true,
      baseUrl: "https://sandbox-api-co.metrc.com",
      licenseNumber: "123-ABC",
      authMode: "x_metrc_key_header",
      bodyJson: [
        { Label: "ABCDEF012345670000010001", Id: 1 },
        { Label: "ABCDEF012345670000010002", Id: 2 },
      ],
    });

    const svc = new MetrcAvailablePlantTagsService();
    const out = await svc.fetchLabels({ companyId: "c1", limit: 10 });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.labels).toEqual(["ABCDEF012345670000010001", "ABCDEF012345670000010002"]);
    expect(out.parsedCount).toBe(2);
    expect(performGetMock).toHaveBeenCalledWith({
      companyId: "c1",
      pathnameAndQuery: "/tags/v2/plant/available?licenseNumber=123-ABC",
    });
  });

  it("fails fast when license missing", async () => {
    listMock.mockResolvedValue(
      companyRow({
        ...baseMetrc,
        licenseNumber: "",
      }),
    );

    const svc = new MetrcAvailablePlantTagsService();
    const out = await svc.fetchLabels({ companyId: "c1", limit: 10 });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.status).toBe(400);
    expect(performGetMock).not.toHaveBeenCalled();
  });
});
