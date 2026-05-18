import { describe, expect, it } from "vitest";
import { computeOilPoolAvailableGrams } from "./edibleOilReservations.js";

describe("computeOilPoolAvailableGrams", () => {
  it("subtracts packaging, kitchen use, and reservations from output", () => {
    expect(computeOilPoolAvailableGrams(1000, 200, 36.67, 100)).toBe(663.33);
  });

  it("never returns negative availability", () => {
    expect(computeOilPoolAvailableGrams(100, 90, 20, 10)).toBe(0);
  });
});
