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

describe("MetrcClient auth", () => {
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
    const d = describeMetrcAuthMode("basic_metrc_user");
    expect(d.basicUsernameLabel).toBe("metrc");
    expect(JSON.stringify(d)).not.toMatch(/USERKEY|password/i);
  });

  it("uses Basic metrc:userKey and x-metrc-key on first attempt", async () => {
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
    if (!out.ok) return;
    expect(out.authMode).toBe("basic_metrc_user");

    const cfg = axiosRequest.mock.calls[0]?.[0];
    expect(cfg?.headers?.["x-metrc-key"]).toBe("VENDOR");
    const decoded = Buffer.from(
      String(cfg?.headers?.Authorization).replace("Basic ", ""),
      "base64",
    ).toString("utf8");
    expect(decoded).toBe("metrc:USERKEY");
    expect(decoded).not.toContain("LIC-1");
  });

  it("falls back to bearer after 401 on basic_metrc_user", async () => {
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

    const out = await client.get("/facilities/v2/");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.authMode).toBe("basic_any_user");
    expect(axiosRequest).toHaveBeenCalledTimes(2);

    const second = axiosRequest.mock.calls[1]?.[0];
    const decoded = Buffer.from(
      String(second?.headers?.Authorization).replace("Basic ", ""),
      "base64",
    ).toString("utf8");
    expect(decoded).toBe("any:USERKEY");
  });

  it("caches successful auth mode for company", async () => {
    axiosRequest.mockResolvedValue({
      status: 200,
      data: [],
      headers: {},
      statusText: "OK",
      config: {},
    });

    const creds = {
      environment: "sandbox" as const,
      stateCode: "CO",
      vendorApiKey: "V",
      userApiKey: "U",
      username: "",
      licenseNumber: "L",
    };

    const client1 = new MetrcClient(creds, "co-cache");
    await client1.get("/facilities/v2/");

    expect(buildMetrcClientAuthPlan("co-cache", true)[0]).toBe("basic_metrc_user");

    axiosRequest.mockClear();
    const client2 = new MetrcClient(creds, "co-cache");
    await client2.get("/facilities/v2/");

    expect(axiosRequest).toHaveBeenCalledTimes(1);
    const decoded = Buffer.from(
      String(axiosRequest.mock.calls[0]?.[0]?.headers?.Authorization).replace("Basic ", ""),
      "base64",
    ).toString("utf8");
    expect(decoded).toBe("metrc:U");
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
    expect(out.message).not.toMatch(/<html/i);
    expect(out.upstreamError).toEqual({
      upstream: "metrc",
      type: "html_runtime_error",
      endpoint: "/facilities/v2/",
      status: 500,
    });
  });
});
