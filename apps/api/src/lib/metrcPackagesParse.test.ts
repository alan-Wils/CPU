import { describe, expect, it } from "vitest";
import { parseMetrcPackagesPayload } from "./metrcPackagesParse.js";

describe("metrcPackagesParse", () => {
  it("parses package fields and dedupes by label", () => {
    const rows = parseMetrcPackagesPayload({
      Data: [
        {
          Label: "1A4060300002EE1000000123",
          Item: { Name: "Live Sugar Wax", StrainName: "Guava" },
          Quantity: 500,
          UnitOfMeasureName: "Grams",
          LocationName: "Vault A",
          ProductionBatchNumber: "B-100",
          SourceHarvestNames: ["Harvest 1", "Harvest 2"],
          PackagedDate: "2026-05-01",
          ExpirationDate: "2026-12-01",
        },
        {
          Label: "1A4060300002EE1000000123",
          Quantity: 999,
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      packageLabel: "1A4060300002EE1000000123",
      itemName: "Live Sugar Wax",
      quantity: 999,
      unitOfMeasure: "Grams",
      location: "Vault A",
      productionBatchNumber: "B-100",
      sourceHarvestNames: "Harvest 1, Harvest 2",
      strainName: "Guava",
    });
    expect(rows[0]?.packagedDate).toBeInstanceOf(Date);
    expect(rows[0]?.expirationDate).toBeInstanceOf(Date);
  });

  it("returns empty array for empty payload", () => {
    expect(parseMetrcPackagesPayload({ Data: [] })).toEqual([]);
  });

  it("reads UnitOfWeight when UnitOfMeasureName is absent", () => {
    const rows = parseMetrcPackagesPayload({
      Data: [
        {
          Label: "AAA00090000196B000000001",
          Quantity: 1,
          UnitOfWeight: "Kilograms",
        },
      ],
    });
    expect(rows[0]?.unitOfMeasure).toBe("Kilograms");
  });
});
