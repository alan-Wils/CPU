import { describe, expect, it } from "vitest";
import { METRC_EVALUATION_ADJUST_QUANTITY } from "./metrcPackageEvaluationDefaults.js";

describe("metrcPackageEvaluationDefaults", () => {
  it("uses a small non-zero evaluation adjust quantity", () => {
    expect(METRC_EVALUATION_ADJUST_QUANTITY).toBe(0.01);
  });
});
