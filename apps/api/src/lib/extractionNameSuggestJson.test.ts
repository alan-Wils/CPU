import { describe, expect, it } from "vitest";
import { parseModelSuggestionsJson } from "./extractionNameSuggestJson.js";

describe("parseModelSuggestionsJson", () => {
  it("parses plain JSON", () => {
    const raw = `{ "suggestions": ["Alpha Blend", "Beta Live"] }`;
    expect(parseModelSuggestionsJson(raw)).toEqual(["Alpha Blend", "Beta Live"]);
  });

  it("strips markdown fences", () => {
    const raw = "```json\n{ \"suggestions\": [\"One\"] }\n```";
    expect(parseModelSuggestionsJson(raw)).toEqual(["One"]);
  });

  it("returns empty on invalid", () => {
    expect(parseModelSuggestionsJson("not json")).toEqual([]);
  });
});
