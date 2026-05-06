import { describe, expect, it } from "vitest";
import {
  computeAllocatedDryCanopySqFt,
  computeDryYieldGPerSqFt,
  meanFinite,
  sumTableSquareFeetFromIds,
} from "./strainCanopyMath.js";

describe("sumTableSquareFeetFromIds", () => {
  it("sums matching table square feet", () => {
    const rooms = [
      {
        id: "r1",
        bays: [
          {
            id: "b1",
            tables: [
              { id: "t1", squareFeet: "10" },
              { id: "t2", squareFeet: "5.5" },
            ],
          },
        ],
      },
    ];
    expect(sumTableSquareFeetFromIds(rooms, "r1", "b1", ["t1", "t2"])).toBeCloseTo(15.5);
  });
});

describe("computeAllocatedDryCanopySqFt", () => {
  it("allocates by dry plant fraction", () => {
    expect(computeAllocatedDryCanopySqFt(100, 10, 5)).toBe(50);
    expect(computeAllocatedDryCanopySqFt(100, 10, 10)).toBe(100);
  });
});

describe("computeDryYieldGPerSqFt", () => {
  it("divides grams by canopy", () => {
    expect(computeDryYieldGPerSqFt(453.592, 10)).toBeCloseTo(45.3592, 4);
  });
});

describe("meanFinite", () => {
  it("returns null for empty", () => {
    expect(meanFinite([])).toBeNull();
  });
  it("averages numbers", () => {
    expect(meanFinite([10, 20])).toBe(15);
  });
});
