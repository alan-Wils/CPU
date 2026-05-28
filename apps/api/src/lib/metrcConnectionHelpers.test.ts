import { describe, expect, it } from "vitest";
import {
  extractMetrcApiErrorSummary,
  messageForMetrcHttpFailure,
  parseLocationsPayload,
  parseMetrcPlantBatchWasteReasonNames,
  parsePlantTagLabelsFromAvailableResponse,
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

describe("parsePlantTagLabelsFromAvailableResponse", () => {
  it("parses bare array with Label", () => {
    expect(
      parsePlantTagLabelsFromAvailableResponse([
        { Label: "ABCDEF012345670000010001" },
        { Label: "ABCDEF012345670000010002" },
      ]),
    ).toEqual(["ABCDEF012345670000010001", "ABCDEF012345670000010002"]);
  });

  it("parses Data wrapper", () => {
    expect(
      parsePlantTagLabelsFromAvailableResponse({
        Data: [{ Label: "Z1" }, { label: "z2" }],
      }),
    ).toEqual(["Z1", "z2"]);
  });

  it("dedupes repeated labels", () => {
    expect(
      parsePlantTagLabelsFromAvailableResponse([{ Label: "A" }, { Label: "A" }, { Label: "B" }]),
    ).toEqual(["A", "B"]);
  });
});

describe("parseMetrcPlantBatchWasteReasonNames", () => {
  it("parses bare array with Name", () => {
    expect(
      parseMetrcPlantBatchWasteReasonNames([
        { Name: "Contamination" },
        { Name: "Disease" },
      ]),
    ).toEqual(["Contamination", "Disease"]);
  });

  it("parses Data wrapper and string entries", () => {
    expect(
      parseMetrcPlantBatchWasteReasonNames({
        Data: [{ Name: "Pruning" }, "Other"],
      }),
    ).toEqual(["Pruning", "Other"]);
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

  it("explains 500 and optional METRC detail", () => {
    expect(messageForMetrcHttpFailure(500)).toContain("HTTP 500");
    expect(messageForMetrcHttpFailure(500)).toContain("server error");
    expect(messageForMetrcHttpFailure(500, "Internal")).toContain("(Internal)");
  });
});

describe("extractMetrcApiErrorSummary", () => {
  it("reads Message field", () => {
    expect(extractMetrcApiErrorSummary({ Message: "License invalid" }, "")).toBe("License invalid");
  });

  it("reads Errors[0].Message", () => {
    expect(
      extractMetrcApiErrorSummary({ Errors: [{ Message: "Bad license" }] }, ""),
    ).toBe("Bad license");
  });

  it("ignores long base64-like strings", () => {
    const long = "x".repeat(50);
    expect(extractMetrcApiErrorSummary({ Message: long }, "")).toBeNull();
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
