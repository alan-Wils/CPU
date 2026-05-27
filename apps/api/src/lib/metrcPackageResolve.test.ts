import { describe, expect, it } from "vitest";
import { resolvePackageUnitOfMeasure } from "./metrcPackageResolve.js";

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
