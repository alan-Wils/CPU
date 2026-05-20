import { describe, expect, it } from "vitest";
import { applyFfTrimSourceListToStore, mergeSourceBatchRowsIntoStore } from "@/lib/syncSourceBatchesToStore";

describe("syncSourceBatchesToStore", () => {
  it("merges incoming source rows by id", () => {
    const target = {
      sourceBatches: [{ id: "A", type: "Dry Trim", amount: "1 lbs" }],
    };
    mergeSourceBatchRowsIntoStore(target, [{ id: "B", type: "Dry Trim", amount: "2 lbs" }]);
    expect(target.sourceBatches).toHaveLength(2);
  });

  it("does not wipe production when source list is empty", () => {
    const target = {
      sourceBatches: [],
      productionBatches: [{ id: "TRIM-1", type: "Dry Trim", status: "Available for Extraction" }],
    };
    applyFfTrimSourceListToStore(target, []);
    expect(target.productionBatches).toHaveLength(1);
  });

  it("mirrors active trim into productionBatches", () => {
    const target = { sourceBatches: [], productionBatches: [] };
    applyFfTrimSourceListToStore(target, [
      {
        id: "GMO.3.051926",
        type: "Dry Trim",
        amount: "12 lbs",
        weightLbs: 12,
        status: "Available for Extraction",
      },
    ]);
    expect(target.productionBatches).toHaveLength(1);
    expect((target.productionBatches?.[0] as { id?: string }).id).toBe("GMO.3.051926");
  });
});
