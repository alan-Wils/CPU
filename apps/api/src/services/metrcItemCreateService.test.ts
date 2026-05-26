import { describe, expect, it } from "vitest";
import {
  METRC_DEFAULT_TEST_ITEM_NAME,
  buildMetrcCreateItemBody,
} from "./metrcItemCreateService.js";

describe("buildMetrcCreateItemBody", () => {
  it("builds METRC item create payload with defaults", () => {
    const body = buildMetrcCreateItemBody({
      name: METRC_DEFAULT_TEST_ITEM_NAME,
      productCategory: "Buds",
      unitOfMeasure: "Grams",
    });
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      Name: METRC_DEFAULT_TEST_ITEM_NAME,
      ItemCategory: "Buds",
      UnitOfMeasure: "Grams",
    });
  });

  it("includes optional strain when provided", () => {
    const body = buildMetrcCreateItemBody({
      name: "Test",
      productCategory: "Buds",
      unitOfMeasure: "Grams",
      strainName: "NexBatch Test Strain",
    });
    expect(body[0]).toMatchObject({
      Strain: "NexBatch Test Strain",
    });
  });
});
