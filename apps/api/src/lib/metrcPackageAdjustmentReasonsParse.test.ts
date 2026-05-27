import { describe, expect, it } from "vitest";
import {
  parseMetrcPackageAdjustmentReasonsPayload,
  pickEvaluationPackageAdjustmentReason,
  pickFirstActivePackageAdjustmentReason,
} from "./metrcPackageAdjustmentReasonsParse.js";

describe("metrcPackageAdjustmentReasonsParse", () => {
  it("parses METRC package adjust reasons payload", () => {
    const reasons = parseMetrcPackageAdjustmentReasonsPayload({
      Data: [
        {
          Name: "Drying",
          RequiresNote: false,
        },
        {
          Name: "Entry Error",
          RequiresNote: false,
        },
      ],
      Total: 2,
    });
    expect(reasons.map((r) => r.name)).toEqual(["Drying", "Entry Error"]);
  });

  it("picks the first active reason", () => {
    const reasons = parseMetrcPackageAdjustmentReasonsPayload({
      Data: [{ Name: "Scale Variance" }, { Name: "Drying", IsArchived: true }],
    });
    const selected = pickFirstActivePackageAdjustmentReason(reasons);
    expect(selected?.name).toBe("Scale Variance");
  });

  it("prefers Entry Error for evaluation when listed", () => {
    const reasons = parseMetrcPackageAdjustmentReasonsPayload({
      Data: [{ Name: "Drying" }, { Name: "Entry Error" }],
    });
    expect(pickEvaluationPackageAdjustmentReason(reasons)?.name).toBe("Entry Error");
  });
});
