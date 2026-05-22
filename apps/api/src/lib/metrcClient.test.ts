import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import {
  MetrcClient,
  METRC_HTML_RUNTIME_USER_MESSAGE,
  clearMetrcClientAuthCache,
  describeMetrcAuthMode,
  detectMetrcHtmlResponse,
  resolveSandboxIntegratorSetupUrl,
} from "./metrcClient.js";
import { buildMetrcClientAuthPlan } from "./metrcAuthStrategy.js";

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

describe("MetrcClient sandbox auth", () => {
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

  it("uses vendor-only x-metrc-key for sandbox setup (no user headers, no Basic)", async () => {
    axiosRequest.mockResolvedValue({
      status: 200,
      data: { LicenseNumber: "SBX-CO" },
      headers: {},
      statusText: "OK",
      config: {},
    });

    const client = new MetrcClient(creds, "co-setup");
    const out = await client.request({
      method: "POST",
      pathnameAndQuery: "/sandbox/v2/integrator/setup",
      absoluteUrl: resolveSandboxIntegratorSetupUrl("CO")!,
      vendorOnly: true,
    });

    expect(out.ok).toBe(true);
    const cfg = axiosRequest.mock.calls[0]?.[0];
    expect(cfg?.auth).toBeUndefined();
    expect(cfg?.headers?.Authorization).toBeUndefined();
    expect(cfg?.headers?.["x-metrc-key"]).toBe("VENDOR");
    expect(cfg?.headers?.["x-user-key"]).toBeUndefined();
  });

  it("sandbox operational: tries x-metrc-user-key before basic on 401", async () => {
    axiosRequest
      .mockResolvedValueOnce({
        status: 401,
        data: "Authorization has been denied for this request.",
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

    const client = new MetrcClient(creds, "co-op");
    const out = await client.get("/locations/v2/active?licenseNumber=SBX-CO");

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.authMode).toBe("sandbox_x_metrc_key_and_user_key_header");
    expect(axiosRequest).toHaveBeenCalledTimes(2);

    expect(axiosRequest.mock.calls[0]?.[0]?.headers?.["x-metrc-key"]).toBe("VENDOR");
    expect(axiosRequest.mock.calls[1]?.[0]?.headers?.["x-metrc-user-key"]).toBe("USERKEY");
  });

  it("stops auth rotation on non-401 (403 does not try next mode)", async () => {
    axiosRequest.mockResolvedValue({
      status: 403,
      data: "Forbidden",
      headers: {},
      statusText: "Forbidden",
      config: {},
    });

    const out = await new MetrcClient(creds).get("/locations/v2/active?licenseNumber=SBX-CO");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.attemptedAuthModes).toEqual(["sandbox_x_metrc_key"]);
    expect(axiosRequest).toHaveBeenCalledTimes(1);
  });

  it("describeMetrcAuthMode never includes raw secrets", () => {
    const d = describeMetrcAuthMode("sandbox_x_metrc_key", creds);
    expect(d.hasVendorKey).toBe(true);
    expect(d.licenseNumber).toBe("SBX-CO");
    expect(JSON.stringify(d)).not.toContain("USERKEY");
    expect(JSON.stringify(d)).not.toContain("VENDOR");
  });

  it("caches successful sandbox auth mode", async () => {
    axiosRequest.mockResolvedValue({
      status: 200,
      data: [],
      headers: {},
      statusText: "OK",
      config: {},
    });

    await new MetrcClient(creds, "co-cache").get("/locations/v2/active?licenseNumber=SBX-CO");
    expect(buildMetrcClientAuthPlan({ companyId: "co-cache", vendorOnly: false, environment: "sandbox" })[0]).toBe(
      "sandbox_x_metrc_key",
    );
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
  });
});
