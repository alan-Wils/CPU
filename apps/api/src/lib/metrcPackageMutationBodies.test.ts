import { describe, expect, it } from "vitest";
import {
  buildMetrcPackageAdjustBody,
  buildMetrcPackageChangeItemBody,
  buildMetrcPackageFinishBody,
  buildMetrcPackageUnfinishBody,
} from "./metrcPackageMutationBodies.js";

describe("metrcPackageMutationBodies", () => {
  it("builds METRC v2 change item body", () => {
    const body = buildMetrcPackageChangeItemBody({
      packageLabel: "AAA00090000196B000000001",
      itemName: "NexBatch Test Item",
    });
    expect(body).toEqual([
      { Label: "AAA00090000196B000000001", Item: "NexBatch Test Item" },
    ]);
  });

  it("builds METRC v2 adjust body", () => {
    const body = buildMetrcPackageAdjustBody({
      packageLabel: "AAA00090000196B000000001",
      quantity: 0,
      unitOfMeasure: "Kilograms",
      adjustmentReason: "Inventory Adjustment",
      adjustmentDate: "2026-05-26",
    });
    expect(body[0]).toMatchObject({
      Label: "AAA00090000196B000000001",
      Quantity: 0,
      UnitOfMeasure: "Kilograms",
      AdjustmentReason: "Inventory Adjustment",
    });
  });

  it("builds METRC v2 finish and unfinish bodies", () => {
    expect(
      buildMetrcPackageFinishBody({
        packageLabel: "AAA00090000196B000000001",
        actualDate: "2026-05-26",
      }),
    ).toEqual([{ Label: "AAA00090000196B000000001", ActualDate: "2026-05-26" }]);
    expect(buildMetrcPackageUnfinishBody({ packageLabel: "AAA00090000196B000000001" })).toEqual([
      { Label: "AAA00090000196B000000001" },
    ]);
  });
});
