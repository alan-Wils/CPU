import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";

const require = createRequire(import.meta.url);
const { parseHarvestSheetJsonResponse } = require("./harvestSheetJsonParse.cjs");

describe("parseHarvestSheetJsonResponse", () => {
  it("parses JSON object from model text with prose", () => {
    const raw = `Here is the data:\n{"rows":[{"tag":"12","weightValue":4.2,"unitGuess":"lbs"}],"bundles":null,"totalGrams":1900,"notes":""}\nThanks`;
    const out = parseHarvestSheetJsonResponse(raw);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].tag).toBe("12");
    expect(out.rows[0].weightValue).toBe(4.2);
    expect(out.totalGrams).toBe(1900);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseHarvestSheetJsonResponse("not json")).toThrow();
  });
});
