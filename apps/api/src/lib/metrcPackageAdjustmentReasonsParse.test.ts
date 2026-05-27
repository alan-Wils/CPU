import { describe, expect, it } from "vitest";
import {
  parseMetrcPackageAdjustmentReasonsPayload,
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
});
