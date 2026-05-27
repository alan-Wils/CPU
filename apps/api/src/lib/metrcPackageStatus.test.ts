import { describe, expect, it } from "vitest";
import {
  isPackageFinished,
  isPackageOnHold,
  isPackageQuantityEmpty,
  isPackageTransferable,
} from "./metrcPackageStatus.js";

describe("metrcPackageStatus", () => {
  it("treats near-zero quantity as empty", () => {
    expect(isPackageQuantityEmpty(0)).toBe(true);
    expect(isPackageQuantityEmpty(0.0000001)).toBe(true);
    expect(isPackageQuantityEmpty(0.01)).toBe(false);
  });

  it("detects finished packages from METRC fields", () => {
    expect(isPackageFinished({ raw: { IsFinished: true } })).toBe(true);
    expect(isPackageFinished({ raw: { FinishedDate: "2026-05-26" } })).toBe(true);
    expect(isPackageFinished({ raw: { IsFinished: false, FinishedDate: null } })).toBe(false);
  });

  it("detects on-hold packages", () => {
    expect(isPackageOnHold({ raw: { IsOnHold: true } })).toBe(true);
    expect(isPackageTransferable({ quantity: 1, raw: { IsOnHold: true } })).toBe(false);
  });
});
