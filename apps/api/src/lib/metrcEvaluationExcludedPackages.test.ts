import { describe, expect, it } from "vitest";
import { METRC_EVALUATION_DEFAULT_PACKAGE_LABEL } from "./metrcPackageEvaluationDefaults.js";

describe("metrcEvaluationExcludedPackages", () => {
  it("always excludes the default evaluation mutation package label", () => {
    expect(METRC_EVALUATION_DEFAULT_PACKAGE_LABEL).toBe("AAA00090000196B000000001");
  });
});
