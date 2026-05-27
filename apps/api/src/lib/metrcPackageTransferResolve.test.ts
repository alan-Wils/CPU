import { describe, expect, it } from "vitest";
import { isPackageTransferable } from "./metrcPackageStatus.js";

describe("isPackageTransferable", () => {
  it("accepts active packages with positive quantity", () => {
    expect(
      isPackageTransferable({
        quantity: 10,
        raw: { IsFinished: false, IsOnHold: false },
      }),
    ).toBe(true);
  });

  it("rejects zero, finished, and on-hold packages", () => {
    expect(isPackageTransferable({ quantity: 0, raw: {} })).toBe(false);
    expect(
      isPackageTransferable({
        quantity: 5,
        raw: { IsFinished: true },
      }),
    ).toBe(false);
    expect(
      isPackageTransferable({
        quantity: 5,
        raw: { IsOnHold: true },
      }),
    ).toBe(false);
  });
});
