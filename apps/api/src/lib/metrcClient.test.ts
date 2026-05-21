import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import {
  MetrcClient,
  METRC_HTML_RUNTIME_USER_MESSAGE,
  buildBasicVendorUserAuthorization,
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

describe("MetrcClient Colorado sandbox auth", () => {
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

  it("buildBasicVendorUserAuthorization encodes vendor:user", () => {
    expect(buildBasicVendorUserAuthorization("VENDOR", "USERKEY")).toBe(
      `Basic ${Buffer.from("VENDOR:USERKEY", "utf8").toString("base64")}`,
    );
  });

  it("describeMetrcAuthMode never includes secrets", () => {
    const d = describeMetrcAuthMode("basic_vendor_user");
    expect(d.usesVendorUserPair).toBe(true);
    expect(JSON.stringify(d)).not.toMatch(/apiKey|password|secret/i);
  });

  it("uses Basic vendor:user, Content-Type json, no x-metrc-key or Bearer", async () => {
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

    const out = await client.get("/locations/v2/active?licenseNumber=LIC-1");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.authMode).toBe("basic_vendor_user");

    const cfg = axiosRequest.mock.calls[0]?.[0];
    expect(cfg?.auth).toBeUndefined();
    expect(cfg?.headers?.["x-metrc-key"]).toBeUndefined();
    expect(cfg?.headers?.["Content-Type"]).toBe("application/json");
    expect(cfg?.headers?.Authorization).toBe(buildBasicVendorUserAuthorization("VENDOR", "USERKEY"));
    const decoded = Buffer.from(
      String(cfg?.headers?.Authorization).replace("Basic ", ""),
      "base64",
    ).toString("utf8");
    expect(decoded).toBe("VENDOR:USERKEY");
    expect(axiosRequest).toHaveBeenCalledTimes(1);
  });

  it("does not retry alternate auth modes on 401", async () => {
    axiosRequest.mockResolvedValue({
      status: 401,
      data: "Authorization has been denied for this request.",
      headers: {},
      statusText: "Unauthorized",
      config: {},
    });

    const client = new MetrcClient(
      {
        environment: "sandbox",
        stateCode: "CO",
        vendorApiKey: "VENDOR",
        userApiKey: "USERKEY",
        username: "",
        licenseNumber: "LIC-1",
      },
      "co-2",
    );

    const out = await client.get("/locations/v2/active?licenseNumber=LIC-1");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.attemptedAuthModes).toEqual(["basic_vendor_user"]);
    expect(axiosRequest).toHaveBeenCalledTimes(1);
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

    const client = new MetrcClient({
      environment: "sandbox",
      stateCode: "CO",
      vendorApiKey: "V",
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

    const client = new MetrcClient(
      {
        environment: "sandbox",
        stateCode: "CO",
        vendorApiKey: "V",
        userApiKey: "U",
        username: "",
        licenseNumber: "L",
      },
      "co-html",
    );

    const out = await client.get("/facilities/v2/");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toBe(METRC_HTML_RUNTIME_USER_MESSAGE);
    expect(out.attemptedAuthModes).toEqual(["basic_vendor_user"]);
  });
});
