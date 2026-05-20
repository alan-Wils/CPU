import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import { MetrcClient, resolveSandboxIntegratorSetupUrl } from "./metrcClient.js";

vi.mock("axios", async () => {
  const actual = await vi.importActual<typeof import("axios")>("axios");
  return {
    default: {
      ...actual.default,
      request: vi.fn(),
      isAxiosError: actual.default.isAxiosError,
    },
    isAxiosError: actual.isAxiosError,
  };
});

const axiosRequest = vi.mocked(axios.request);

describe("MetrcClient", () => {
  beforeEach(() => {
    axiosRequest.mockReset();
    (globalThis as { __metrcLastSlotAt?: number }).__metrcLastSlotAt = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("resolveSandboxIntegratorSetupUrl builds CO host", () => {
    expect(resolveSandboxIntegratorSetupUrl("CO")).toBe(
      "https://sandbox-api-co.metrc.com/sandbox/v2/integrator/setup",
    );
  });

  it("sends x-metrc-key and Basic user password on GET", async () => {
    axiosRequest.mockResolvedValue({
      status: 200,
      data: { Data: [] },
      headers: {},
      statusText: "OK",
      config: {},
    });

    const client = new MetrcClient(
      {
        environment: "sandbox",
        stateCode: "CO",
        vendorApiKey: "VENDOR",
        userApiKey: "USERKEY",
        username: "sandbox-user",
        licenseNumber: "LIC-1",
      },
      "co-1",
    );

    const out = await client.get("/facilities/v2/");
    expect(out.ok).toBe(true);
    expect(axiosRequest).toHaveBeenCalled();
    const cfg = axiosRequest.mock.calls[0]?.[0];
    expect(cfg?.headers?.["x-metrc-key"]).toBe("VENDOR");
    expect(String(cfg?.headers?.Authorization)).toMatch(/^Basic /);
    const decoded = Buffer.from(
      String(cfg?.headers?.Authorization).replace("Basic ", ""),
      "base64",
    ).toString("utf8");
    expect(decoded).toBe("sandbox-user:USERKEY");
  });

  it("retries on HTTP 429 then succeeds", async () => {
    axiosRequest
      .mockResolvedValueOnce({
        status: 429,
        data: "Too Many Requests",
        headers: {},
        statusText: "Too Many Requests",
        config: {},
      })
      .mockResolvedValueOnce({
        status: 200,
        data: [],
        headers: {},
        statusText: "OK",
        config: {},
      });

    const client = new MetrcClient({
      environment: "sandbox",
      stateCode: "CO",
      vendorApiKey: "",
      userApiKey: "U",
      username: "",
      licenseNumber: "L",
    });

    const out = await client.get("/strains/v2/active?licenseNumber=L");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.retries).toBe(1);
    expect(axiosRequest).toHaveBeenCalledTimes(2);
  });
});
