import { describe, expect, it } from "vitest";
import { resolveIndicaSativaPercentages } from "./metrcStrainCreateService.js";

describe("resolveIndicaSativaPercentages", () => {
  it("defaults to 50/50 when omitted", () => {
    const result = resolveIndicaSativaPercentages({});
    expect(result).toEqual({ ok: true, indicaPercentage: 50, sativaPercentage: 50 });
  });

  it("rejects when indica and sativa do not sum to 100", () => {
    const result = resolveIndicaSativaPercentages({ indicaPercentage: 40, sativaPercentage: 50 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("must equal 100");
    }
  });
});
