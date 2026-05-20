import { describe, expect, it } from "vitest";
import {
  groupSourceBatchesByHarvest,
  harvestGroupKeyForSourceBatch,
  harvestGroupLabelForSourceBatch,
} from "./extractionSourceHarvestGroups";

describe("extractionSourceHarvestGroups", () => {
  it("groups bundles by parentGroupId", () => {
    const rows = [
      {
        id: "ff-1",
        source: "BUKU.4.051926",
        parentGroupId: "ff-group-1",
        type: "Fresh Frozen",
        grams: 3000,
        weightLbs: 6.61,
        bundles: 1,
      },
      {
        id: "ff-2",
        source: "BUKU.4.051926",
        parentGroupId: "ff-group-1",
        type: "Fresh Frozen",
        grams: 30000,
        weightLbs: 66.14,
        bundles: 1,
      },
    ];
    expect(harvestGroupKeyForSourceBatch(rows[0])).toBe(harvestGroupKeyForSourceBatch(rows[1]));
    const groups = groupSourceBatchesByHarvest(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Batch BUKU.4.051926");
    expect(groups[0].packageCount).toBe(2);
  });

  it("groups legacy rows by cultivation batch when no parentGroupId", () => {
    const rows = [
      { id: "a", source: "BUKU.4.051926", type: "Fresh Frozen", grams: 1000, weightLbs: 2.2 },
      { id: "b", source: "BUKU.4.051926", type: "Fresh Frozen", grams: 2000, weightLbs: 4.4 },
    ];
    const groups = groupSourceBatchesByHarvest(rows);
    expect(groups).toHaveLength(1);
    expect(harvestGroupLabelForSourceBatch(rows[0])).toBe("Batch BUKU.4.051926");
  });

  it("splits different harvest dates on same batch", () => {
    const rows = [
      { id: "a", source: "BUKU.4.051926", harvestDate: "2026-05-19", type: "Fresh Frozen" },
      { id: "b", source: "BUKU.4.051926", harvestDate: "2026-05-20", type: "Fresh Frozen" },
    ];
    expect(groupSourceBatchesByHarvest(rows)).toHaveLength(2);
  });
});
