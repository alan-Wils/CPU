import { afterEach, describe, expect, it } from "vitest";
import {
  buildMetrcEndpointCandidates,
  cacheMetrcEndpointPath,
  clearMetrcEndpointCache,
  orderMetrcEndpointCandidates,
  shouldTryNextMetrcEndpoint,
} from "./metrcEndpoints.js";

describe("metrcEndpoints", () => {
  afterEach(() => {
    clearMetrcEndpointCache();
  });

  it("uses v1 active paths for CO sandbox resources", () => {
    expect(buildMetrcEndpointCandidates("facilities", "")).toEqual([
      "/facilities/v1/active",
      "/facilities/v2/",
      "/facilities/v2/active",
    ]);
    expect(buildMetrcEndpointCandidates("strains", "LIC-1")[0]).toBe(
      "/strains/v1/active?licenseNumber=LIC-1",
    );
    expect(buildMetrcEndpointCandidates("rooms", "LIC-1")[0]).toBe(
      "/locations/v1/active?licenseNumber=LIC-1",
    );
    expect(buildMetrcEndpointCandidates("packages", "LIC-1")).toEqual([
      "/packages/v2/active?licenseNumber=LIC-1",
    ]);
  });

  it("puts cached successful path first per state/environment", () => {
    const ctx = { stateCode: "CO", environment: "sandbox" as const };
    cacheMetrcEndpointPath(ctx, "strains", "/strains/v2/active?licenseNumber=X");
    const ordered = orderMetrcEndpointCandidates(ctx, "strains", "LIC-1");
    expect(ordered[0]).toBe("/strains/v2/active?licenseNumber=LIC-1");
  });

  it("shouldTryNextMetrcEndpoint on html and 404", () => {
    expect(
      shouldTryNextMetrcEndpoint("facilities", 0, 3, {
        status: 500,
        upstreamType: "html_runtime_error",
      }),
    ).toBe(true);
    expect(shouldTryNextMetrcEndpoint("packages", 0, 1, { status: 404 })).toBe(false);
    expect(shouldTryNextMetrcEndpoint("strains", 0, 2, { status: 404 })).toBe(true);
  });
});
