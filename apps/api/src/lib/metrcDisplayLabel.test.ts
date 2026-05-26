import { describe, expect, it } from "vitest";
import { readMetrcDisplayLabel } from "./metrcDisplayLabel.js";

describe("readMetrcDisplayLabel", () => {
  it("returns trimmed strings and never [object Object]", () => {
    expect(readMetrcDisplayLabel(" Processor ")).toBe("Processor");
    expect(readMetrcDisplayLabel({ Name: "Cultivation" })).toBe("Cultivation");
    expect(readMetrcDisplayLabel({ NameDisplay: "Processor (MIP)" })).toBe("Processor (MIP)");
    expect(readMetrcDisplayLabel({ Label: "Retail", Value: 3 })).toBe("Retail");
    expect(readMetrcDisplayLabel({})).toBe("");
    expect(readMetrcDisplayLabel({ foo: "bar" })).toBe("");
    expect(readMetrcDisplayLabel({ unknown: { nested: true } })).toBe("");
  });
});
