import { describe, expect, it } from "vitest";
import { METRC_EVALUATION_ADJUST_QUANTITY } from "./metrcPackageEvaluationDefaults.js";

describe("metrcPackageEvaluationDefaults", () => {
  it("targets zero remaining quantity after evaluation adjust", () => {
    expect(METRC_EVALUATION_ADJUST_QUANTITY).toBe(0);
  });
});
