import { afterEach, describe, expect, it } from "vitest";
import {
  METRC_ENDPOINT_NOT_AVAILABLE_MESSAGE,
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

  it("uses Colorado v2 license-scoped routes with v1 fallback", () => {
    expect(buildMetrcEndpointCandidates("facilities", "")).toEqual(["/facilities/v2/"]);
    expect(buildMetrcEndpointCandidates("facilities", "")).not.toContain("/facilities/v2/active");
    expect(buildMetrcEndpointCandidates("rooms", "LIC-1")).toEqual([
      "/locations/v2/active?licenseNumber=LIC-1",
      "/locations/v1/active?licenseNumber=LIC-1",
    ]);
    expect(buildMetrcEndpointCandidates("strains", "LIC-1")[0]).toBe(
      "/strains/v2/active?licenseNumber=LIC-1",
    );
    expect(buildMetrcEndpointCandidates("packages", "LIC-1")).toEqual([
      "/packages/v2/active?licenseNumber=LIC-1",
      "/packages/v1/active?licenseNumber=LIC-1",
    ]);
  });

  it("puts cached successful path first per state/environment", () => {
    const ctx = { stateCode: "CO", environment: "sandbox" as const };
    cacheMetrcEndpointPath(ctx, "strains", "/strains/v1/active?licenseNumber=X");
    const ordered = orderMetrcEndpointCandidates(ctx, "strains", "LIC-1");
    expect(ordered[0]).toBe("/strains/v1/active?licenseNumber=LIC-1");
  });

  it("shouldTryNextMetrcEndpoint on html and 404", () => {
    expect(
      shouldTryNextMetrcEndpoint("rooms", 0, 2, {
        status: 404,
      }),
    ).toBe(true);
    expect(shouldTryNextMetrcEndpoint("facilities", 0, 1, { status: 404 })).toBe(false);
    expect(shouldTryNextMetrcEndpoint("packages", 0, 1, { status: 404 })).toBe(false);
    expect(METRC_ENDPOINT_NOT_AVAILABLE_MESSAGE).toContain("404");
  });
});
