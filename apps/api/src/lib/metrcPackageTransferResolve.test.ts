import { describe, expect, it } from "vitest";
import { isPackageTransferable } from "./metrcPackageStatus.js";
import { resolveSyncedPackageQuantity } from "./metrcPackageResolve.js";

describe("transfer package selection helpers", () => {
  it("prefers synced DB quantity over stale positive raw payload", () => {
    expect(
      resolveSyncedPackageQuantity({
        persistedQuantity: 0,
        raw: { Quantity: 0.01 },
      }),
    ).toBe(0);
  });

  it("rejects zero-quantity packages for transfer", () => {
    expect(isPackageTransferable({ quantity: 0, raw: { IsFinished: false, IsOnHold: false } })).toBe(
      false,
    );
  });
});
