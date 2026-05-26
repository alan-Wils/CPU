import { describe, expect, it } from "vitest";
import {
  buildHarvestPackageCreatePathCandidates,
  buildMetrcHarvestPackageCreateBody,
} from "./metrcPackageCreateService.js";

describe("buildMetrcHarvestPackageCreateBody", () => {
  it("uses HarvestId when numeric", () => {
    const body = buildMetrcHarvestPackageCreateBody({
      packageTag: "TAG001",
      itemName: "Buds",
      quantity: 10,
      unitOfMeasure: "Grams",
      locationName: "Room A",
      packagedDate: "2026-05-26",
      note: "test",
      metrcHarvestId: "12345",
      harvestName: "2026-Harvest-A",
    });
    expect(body).toHaveLength(1);
    const row = body[0] as Record<string, unknown>;
    expect(row.Tag).toBe("TAG001");
    expect(row.Item).toBe("Buds");
    expect(row.UnitOfWeight).toBe("Grams");
    const ingredients = row.Ingredients as Array<Record<string, unknown>>;
    expect(ingredients[0]?.HarvestId).toBe(12345);
    expect(ingredients[0]?.HarvestName).toBeNull();
    expect(ingredients[0]?.Weight).toBe(10);
  });

  it("uses HarvestName when id is not numeric", () => {
    const body = buildMetrcHarvestPackageCreateBody({
      packageTag: "TAG002",
      itemName: "Shake",
      quantity: 5,
      unitOfMeasure: "Grams",
      locationName: null,
      packagedDate: "2026-05-26",
      note: null,
      metrcHarvestId: "pending-harvest",
      harvestName: "2026-Harvest-B",
    });
    const ingredients = (body[0] as Record<string, unknown>).Ingredients as Array<
      Record<string, unknown>
    >;
    expect(ingredients[0]?.HarvestId).toBeNull();
    expect(ingredients[0]?.HarvestName).toBe("2026-Harvest-B");
  });
});

describe("buildHarvestPackageCreatePathCandidates", () => {
  it("returns v2 then v1 harvest package paths", () => {
    const paths = buildHarvestPackageCreatePathCandidates("LIC-1");
    expect(paths[0]).toContain("/harvests/v2/packages");
    expect(paths[1]).toContain("/harvests/v1/create/packages");
  });
});
