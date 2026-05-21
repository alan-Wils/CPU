import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import {
  MetrcClient,
  METRC_HTML_RUNTIME_USER_MESSAGE,
  buildMetrcClientAuthPlan,
  clearMetrcClientAuthCache,
  describeMetrcAuthMode,
  detectMetrcHtmlResponse,
  resolveSandboxIntegratorSetupUrl,
} from "./metrcClient.js";

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

const creds = {
  environment: "sandbox" as const,
  stateCode: "CO",
  vendorApiKey: "VENDOR",
  userApiKey: "USERKEY",
  username: "",
  licenseNumber: "SBX-CO",
};

describe("MetrcClient Connect header auth", () => {
  beforeEach(() => {
    axiosRequest.mockReset();
    clearMetrcClientAuthCache();
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

  it("describeMetrcAuthMode never includes secrets", () => {
    const d = describeMetrcAuthMode("x_metrc_key_header", creds);
    expect(d.hasVendorKey).toBe(true);
    expect(d.hasUserKey).toBe(true);
    expect(d.licenseNumber).toBe("SBX-CO");
    const serialized = JSON.stringify(d);
    expect(serialized).not.toContain("VENDOR");
    expect(serialized).not.toContain("USERKEY");
  });

  it("uses x-metrc-key only on first attempt (no Basic auth)", async () => {
    axiosRequest.mockResolvedValue({
      status: 200,
      data: { Data: [] },
      headers: {},
      statusText: "OK",
      config: {},
    });

    const client = new MetrcClient(creds, "co-1");
    const out = await client.get("/locations/v2/active?licenseNumber=SBX-CO");

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.authMode).toBe("x_metrc_key_header");

    const cfg = axiosRequest.mock.calls[0]?.[0];
    expect(cfg?.auth).toBeUndefined();
    expect(cfg?.headers?.Authorization).toBeUndefined();
    expect(cfg?.headers?.["x-metrc-key"]).toBe("VENDOR");
    expect(cfg?.headers?.["x-metrc-user-key"]).toBeUndefined();
    expect(cfg?.headers?.["Content-Type"]).toBe("application/json");
    expect(axiosRequest).toHaveBeenCalledTimes(1);
  });

  it("falls back to x-metrc-user-key then x-metrc-userkey on 401", async () => {
    axiosRequest
      .mockResolvedValueOnce({
        status: 401,
        data: "Authorization has been denied for this request.",
        headers: {},
        statusText: "Unauthorized",
        config: {},
      })
      .mockResolvedValueOnce({
        status: 401,
        data: "denied",
        headers: {},
        statusText: "Unauthorized",
        config: {},
      })
      .mockResolvedValueOnce({
        status: 200,
        data: [],
        headers: {},
        statusText: "OK",
        config: {},
      });

    const client = new MetrcClient(creds, "co-2");
    const out = await client.get("/locations/v2/active?licenseNumber=SBX-CO");

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.authMode).toBe("x_metrc_key_and_userkey_header");
    expect(axiosRequest).toHaveBeenCalledTimes(3);

    expect(axiosRequest.mock.calls[0]?.[0]?.headers?.["x-metrc-key"]).toBe("VENDOR");
    expect(axiosRequest.mock.calls[0]?.[0]?.headers?.Authorization).toBeUndefined();

    expect(axiosRequest.mock.calls[1]?.[0]?.headers?.["x-metrc-user-key"]).toBe("USERKEY");

    expect(axiosRequest.mock.calls[2]?.[0]?.headers?.["x-metrc-userkey"]).toBe("USERKEY");
  });

  it("returns METRC message and status on final 401", async () => {
    axiosRequest.mockResolvedValue({
      status: 401,
      data: "Authorization has been denied for this request.",
      headers: {},
      statusText: "Unauthorized",
      config: {},
    });

    const client = new MetrcClient(creds, "co-3");
    const out = await client.get("/locations/v2/active?licenseNumber=SBX-CO");

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.status).toBe(401);
    expect(out.metrcMessage).toContain("Authorization has been denied");
    expect(out.attemptedAuthModes).toEqual([
      "x_metrc_key_header",
      "x_metrc_key_and_user_key_header",
      "x_metrc_key_and_userkey_header",
    ]);
  });

  it("caches successful auth mode for company", async () => {
    axiosRequest.mockResolvedValue({
      status: 200,
      data: [],
      headers: {},
      statusText: "OK",
      config: {},
    });

    await new MetrcClient(creds, "co-cache").get("/locations/v2/active?licenseNumber=SBX-CO");
    expect(buildMetrcClientAuthPlan("co-cache", false)[0]).toBe("x_metrc_key_header");

    axiosRequest.mockClear();
    await new MetrcClient(creds, "co-cache").get("/locations/v2/active?licenseNumber=SBX-CO");
    expect(axiosRequest).toHaveBeenCalledTimes(1);
    expect(axiosRequest.mock.calls[0]?.[0]?.headers?.["x-metrc-key"]).toBe("VENDOR");
    expect(axiosRequest.mock.calls[0]?.[0]?.headers?.["x-metrc-user-key"]).toBeUndefined();
  });

  it("retries on HTTP 429 within same auth mode", async () => {
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

    const client = new MetrcClient(creds);
    const out = await client.get("/strains/v2/active?licenseNumber=SBX-CO");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.retries).toBe(1);
    expect(axiosRequest).toHaveBeenCalledTimes(2);
  });

  it("detectMetrcHtmlResponse matches content-type and body", () => {
    expect(detectMetrcHtmlResponse("text/html; charset=utf-8", "")).toBe(true);
    expect(detectMetrcHtmlResponse(null, "<html><body>Runtime Error</body></html>")).toBe(true);
    expect(detectMetrcHtmlResponse("application/json", '{"Data":[]}')).toBe(false);
  });

  it("returns structured html_runtime_error without raw HTML in message", async () => {
    axiosRequest.mockResolvedValue({
      status: 500,
      data: "<!DOCTYPE html><html><body>Runtime Error</body></html>",
      headers: { "content-type": "text/html; charset=utf-8" },
      statusText: "Internal Server Error",
      config: {},
    });

    const out = await new MetrcClient(creds).get("/facilities/v2/");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toBe(METRC_HTML_RUNTIME_USER_MESSAGE);
    expect(out.metrcMessage).toBe(METRC_HTML_RUNTIME_USER_MESSAGE);
  });
});
