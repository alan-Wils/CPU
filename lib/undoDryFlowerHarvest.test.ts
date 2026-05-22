import { describe, expect, it } from "vitest";
import {
  dryFlowerBatchHasPostHarvestWork,
  getUndoDryFlowerHarvestBlockReason,
  undoDryFlowerHarvestInStore,
} from "./undoDryFlowerHarvest";

describe("undoDryFlowerHarvest", () => {
  it("blocks undo after bucking weights are logged", () => {
    const batch = {
      id: "DRY-1",
      source: "FL-1",
      status: "Drying / Curing",
      testStatus: "Not Submitted",
      buckWholePlantLbs: 10,
    };
    expect(dryFlowerBatchHasPostHarvestWork(batch)).toBe(true);
    expect(getUndoDryFlowerHarvestBlockReason(batch)).toMatch(/before bucking/i);
  });

  it("restores plants on parent and removes dry batch from production lists", () => {
    const store = {
      cultivationBatches: [] as any[],
      completedCultivationBatches: [
        {
          id: "FL-1",
          strain: "Flo Limone",
          plants: 0,
          plantsHarvestedDry: 12,
          stage: "Harvested",
          status: "Complete",
          flowerRoom: "Flower 1",
          completedAt: "2026-01-28T12:00:00.000Z",
        },
      ],
      dryFlowerBatches: [
        {
          id: "DRY-FLLI.012826-1",
          source: "FL-1",
          status: "Drying / Curing",
          testStatus: "Not Submitted",
          plantsHarvested: 12,
        },
      ],
      productionBatches: [
        {
          id: "DRY-FLLI.012826-1",
          source: "FL-1",
        },
      ],
      logs: [
        {
          batch: "FL-1",
          linkedBatch: "DRY-FLLI.012826-1",
          task: "Harvest - A Grade Flower",
        },
        { batch: "DRY-FLLI.012826-1", task: "Bucking" },
      ],
    };

    const result = undoDryFlowerHarvestInStore(store, "DRY-FLLI.012826-1");
    expect(result).toEqual({
      ok: true,
      dryBatchId: "DRY-FLLI.012826-1",
      parentBatchId: "FL-1",
      plantsRestored: 12,
      parentStage: "Flower",
      reactivatedFromCompleted: true,
    });

    expect(store.dryFlowerBatches).toHaveLength(0);
    expect(store.productionBatches).toHaveLength(0);
    expect(store.completedCultivationBatches).toHaveLength(0);
    const parent = store.cultivationBatches[0];
    expect(parent.plants).toBe(12);
    expect(parent.plantsHarvestedDry).toBe(0);
    expect(parent.stage).toBe("Flower");
    expect(parent.status).toBe("Active");
    expect(parent.completedAt).toBeUndefined();
    expect(store.logs).toHaveLength(0);
  });
});
