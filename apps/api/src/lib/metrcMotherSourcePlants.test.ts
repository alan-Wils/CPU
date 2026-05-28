import { describe, expect, it } from "vitest";
import {
  isMetrcMotherSourceGrowthPhase,
  parseMetrcPlantApiId,
} from "./metrcMotherSourcePlants.js";

describe("metrcMotherSourcePlants", () => {
  it("accepts vegetative and flowering phases only", () => {
    expect(isMetrcMotherSourceGrowthPhase("Vegetative")).toBe(true);
    expect(isMetrcMotherSourceGrowthPhase("Flowering")).toBe(true);
    expect(isMetrcMotherSourceGrowthPhase("Mother")).toBe(true);
    expect(isMetrcMotherSourceGrowthPhase("Immature")).toBe(false);
    expect(isMetrcMotherSourceGrowthPhase("Clone")).toBe(false);
  });

  it("parses numeric METRC plant ids", () => {
    expect(parseMetrcPlantApiId("42")).toBe(42);
    expect(parseMetrcPlantApiId("")).toBeNull();
    expect(parseMetrcPlantApiId("ABC")).toBeNull();
  });
});
