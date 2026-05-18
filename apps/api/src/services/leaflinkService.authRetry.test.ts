import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { AppError } from "../errors/AppError.js";

vi.mock("../lib/logger.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

import { fetchJsonWithRetry } from "./leaflinkService.js";

describe("fetchJsonWithRetry auth handling", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("does not retry the same request after a classified 403", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ detail: "Not permitted for this auth mode" }),
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      fetchJsonWithRetry(
        "https://app.leaflink.com/api/v2/products/",
        { method: "GET", headers: {} },
        5_000,
        {
          authContext: {
            tenantKey: "https://app.leaflink.com/api|co1",
            authMode: "App",
            endpoint: "https://app.leaflink.com/api/v2/products/",
          },
        },
      ),
    ).rejects.toBeInstanceOf(AppError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once on 502 then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        headers: { get: () => "application/json" },
        text: async () => "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        text: async () => '{"ok":true}',
      });
    globalThis.fetch = fetchMock as typeof fetch;

    const out = await fetchJsonWithRetry(
      "https://app.leaflink.com/api/v2/products/",
      { method: "GET", headers: {} },
      5_000,
    );
    expect(out).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
