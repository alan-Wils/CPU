import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import { probeMetrcKeysPossiblySwapped } from "./metrcKeySwapProbe.js";

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

const loaded = {
  company: {},
  metrc: {},
  vendorApiKey: "USER-KEY-STORED-IN-VENDOR-SLOT-48CHARSXXXX",
  userApiKey: "VENDOR-KEY-STORED-IN-USER-SLOT-48CHARSXXXXX",
  username: "",
  licenseNumber: "SBX-CO",
  facilityName: "",
  stateCode: "CO",
  environment: "sandbox" as const,
  apiBaseUrlOverride: "",
};

describe("probeMetrcKeysPossiblySwapped", () => {
  beforeEach(() => {
    axiosRequest.mockReset();
    (globalThis as { __metrcLastSlotAt?: number }).__metrcLastSlotAt = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when swapped header auth succeeds", async () => {
    axiosRequest.mockResolvedValue({
      status: 200,
      data: [{ Id: 1, Name: "Room" }],
      headers: {},
      statusText: "OK",
      config: {},
    });

    const swapped = await probeMetrcKeysPossiblySwapped({
      loaded,
      companyId: "co-swap",
      pathnameAndQuery: "/locations/v2/active?licenseNumber=SBX-CO",
    });

    expect(swapped).toBe(true);
    const cfg = axiosRequest.mock.calls[0]?.[0];
    expect(cfg?.headers?.["x-metrc-key"]).toBe(loaded.userApiKey);
    expect(cfg?.headers?.["x-metrc-user-key"]).toBe(loaded.vendorApiKey);
  });

  it("returns false when swapped probe still returns 401", async () => {
    axiosRequest.mockResolvedValue({
      status: 401,
      data: "denied",
      headers: {},
      statusText: "Unauthorized",
      config: {},
    });

    const swapped = await probeMetrcKeysPossiblySwapped({
      loaded,
      companyId: "co-swap",
      pathnameAndQuery: "/locations/v2/active?licenseNumber=SBX-CO",
    });

    expect(swapped).toBe(false);
  });
});
