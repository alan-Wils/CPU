import { describe, expect, it } from "vitest";
import { parseMetrcItemsPayload } from "./metrcItemsParse.js";

describe("parseMetrcItemsPayload", () => {
  it("parses METRC items active response rows", () => {
    const rows = parseMetrcItemsPayload({
      Data: [
        {
          Id: 42,
          Name: "Buds",
          ProductCategoryName: "Buds",
          UnitOfMeasureName: "Grams",
          QuantityType: "WeightBased",
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      metrcItemId: "42",
      itemName: "Buds",
      categoryName: "Buds",
      unitOfMeasureName: "Grams",
      quantityType: "WeightBased",
    });
  });
});
