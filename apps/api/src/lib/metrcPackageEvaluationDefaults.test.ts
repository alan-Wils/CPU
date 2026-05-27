import { describe, expect, it } from "vitest";
import {
  METRC_EVALUATION_DEFAULT_ADJUSTMENT_REASON,
  resolveMetrcPackageAdjustmentReason,
} from "./metrcPackageEvaluationDefaults.js";

describe("resolveMetrcPackageAdjustmentReason", () => {
  it("uses Inventory Adjustment when reason is missing or legacy Entry Error", () => {
    expect(resolveMetrcPackageAdjustmentReason(null)).toBe(
      METRC_EVALUATION_DEFAULT_ADJUSTMENT_REASON,
    );
    expect(resolveMetrcPackageAdjustmentReason("Entry Error")).toBe("Inventory Adjustment");
  });

  it("keeps an explicit non-legacy reason", () => {
    expect(resolveMetrcPackageAdjustmentReason("Correction")).toBe("Correction");
  });
});
