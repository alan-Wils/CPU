import { describe, expect, it } from "vitest";
import {
  messageForMetrcHttpFailure,
  parseLocationsPayload,
  toSampleLocation,
} from "./metrcConnectionHelpers.js";
import { resolveMetrcApiBaseUrl } from "./metrcResolveBaseUrl.js";

describe("parseLocationsPayload", () => {
  it("reads bare array", () => {
    const rows = parseLocationsPayload([{ Id: 1, Name: "A" }]);
    expect(rows).toHaveLength(1);
  });

  it("reads METRC Data wrapper", () => {
    const rows = parseLocationsPayload({
      Data: [
        { Id: 2, Name: "Room" },
        { Id: 3, DisplayName: "X" },
      ],
    });
    expect(rows).toHaveLength(2);
  });

  it("returns empty for invalid", () => {
    expect(parseLocationsPayload(null)).toEqual([]);
    expect(parseLocationsPayload({})).toEqual([]);
  });
});

describe("toSampleLocation", () => {
  it("maps Id and Name", () => {
    expect(toSampleLocation({ Id: 9, Name: "Grow 1" })).toEqual({
      id: 9,
      name: "Grow 1",
    });
  });
});

describe("messageForMetrcHttpFailure", () => {
  it("maps auth errors", () => {
    expect(messageForMetrcHttpFailure(401)).toContain("Authentication failed");
    expect(messageForMetrcHttpFailure(403)).toContain("Permission denied");
    expect(messageForMetrcHttpFailure(400)).toContain("Bad request");
  });
});

describe("resolveMetrcApiBaseUrl", () => {
  it("uses override", () => {
    expect(
      resolveMetrcApiBaseUrl({
        apiBaseUrlOverride: "https://api-co.metrc.com/",
        stateCode: "",
      }),
    ).toBe("https://api-co.metrc.com");
  });

  it("builds production host from state", () => {
    expect(resolveMetrcApiBaseUrl({ stateCode: "CO", environment: "production" })).toBe(
      "https://api-co.metrc.com",
    );
  });

  it("builds sandbox host", () => {
    expect(resolveMetrcApiBaseUrl({ stateCode: "CA", environment: "sandbox" })).toBe(
      "https://sandbox-api-ca.metrc.com",
    );
  });

  it("returns null without state or override", () => {
    expect(resolveMetrcApiBaseUrl({ stateCode: "", environment: "production" })).toBeNull();
  });
});
