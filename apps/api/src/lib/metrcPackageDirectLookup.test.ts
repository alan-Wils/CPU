import { describe, expect, it, vi } from "vitest";

const { getMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
}));

vi.mock("./metrcClient.js", async () => {
  const actual = await vi.importActual<typeof import("./metrcClient.js")>("./metrcClient.js");
  return {
    ...actual,
    MetrcClient: class {
      get = getMock;
    },
  };
});

import { fetchMetrcPackageByLabel } from "./metrcPackageDirectLookup.js";
import { MetrcClient } from "./metrcClient.js";

describe("fetchMetrcPackageByLabel", () => {
  it("parses a direct package by label response", async () => {
    getMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        Label: "AAA00090000196B000000005",
        Id: 46901,
        Quantity: 10,
        UnitOfWeight: "Grams",
      },
      durationMs: 1,
      retries: 0,
      rateLimitWaitedMs: 0,
      authMode: "sandbox_basic_vendor_user",
      metrcMessage: "OK",
    });

    const client = new MetrcClient({
      baseUrl: "https://sandbox-api-co.metrc.com",
      vendorKey: "vendor",
      userKey: "user",
      companyId: "c1",
    });

    const result = await fetchMetrcPackageByLabel({
      client,
      packageLabel: "AAA00090000196B000000005",
      licenseNumber: "SF-SBX-CO-7-13402",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.packageLabel).toBe("AAA00090000196B000000005");
      expect(result.packageId).toBe("46901");
      expect(result.endpoint).toContain("/packages/v2/");
    }
  });
});
