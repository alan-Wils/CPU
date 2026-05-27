import { describe, expect, it } from "vitest";
import {
  resolveEvaluationAdjustQuantity,
  resolvePackageQuantity,
  resolvePackageUnitOfMeasure,
} from "./metrcPackageResolve.js";

describe("resolvePackageUnitOfMeasure", () => {
  it("prefers UnitOfWeight from raw METRC payload over persisted row", () => {
    expect(
      resolvePackageUnitOfMeasure({
        persistedUnitOfMeasure: "Grams",
        raw: { UnitOfWeight: "Kilograms" },
      }),
    ).toBe("Kilograms");
  });

  it("reads UnitOfWeight from raw METRC payload when row unit is empty", () => {
    expect(
      resolvePackageUnitOfMeasure({
        persistedUnitOfMeasure: "",
        raw: { UnitOfWeight: "Kilograms" },
      }),
    ).toBe("Kilograms");
  });

  it("returns empty when no unit is available", () => {
    expect(resolvePackageUnitOfMeasure({ persistedUnitOfMeasure: "", raw: {} })).toBe("");
  });
});

describe("resolvePackageQuantity", () => {
  it("reads quantity from raw METRC payload", () => {
    expect(resolvePackageQuantity({ persistedQuantity: 0, raw: { Quantity: 0.01 } })).toBe(0.01);
  });
});

describe("resolveEvaluationAdjustQuantity", () => {
  it("returns negative current quantity to zero out package for finish", () => {
    expect(
      resolveEvaluationAdjustQuantity({
        quantity: 0.01,
        raw: { Quantity: 0.01 },
      }),
    ).toBe(-0.01);
  });

  it("returns 0 when package is already empty", () => {
    expect(resolveEvaluationAdjustQuantity({ quantity: 0, raw: { Quantity: 0 } })).toBe(0);
  });
});
