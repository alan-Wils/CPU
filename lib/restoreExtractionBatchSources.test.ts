import { describe, expect, it } from "vitest";
import {
  applyExtractionBatchSourceRestorePlansToStore,
  buildExtractionBatchSourceRestorePlans,
  extractionBatchCanRestoreSources,
} from "@/lib/restoreExtractionBatchSources";

describe("restoreExtractionBatchSources", () => {
  it("allows restore only for fresh batches without tasks or merges", () => {
    expect(
      extractionBatchCanRestoreSources(
        {
          id: "EXT-1",
          sources: [{ sourceId: "SRC-1", amountUsed: 2 }],
          completedTasks: [],
        },
        [],
        [],
      ),
    ).toBe(true);

    expect(
      extractionBatchCanRestoreSources(
        {
          id: "EXT-1",
          sources: [{ sourceId: "SRC-1", amountUsed: 2 }],
          completedTasks: ["Pack Socks Start"],
        },
        [],
        [],
      ),
    ).toBe(false);
  });

  it("restores remaining amount and moves completed sources back to active", () => {
    const store = {
      sourceBatches: [],
      completedSourceBatches: [
        {
          id: "SRC-1",
          weightLbs: 10,
          remainingAmount: 0,
          status: "Complete",
        },
      ],
      productionBatches: [],
    };

    const batch = {
      id: "EXT-1",
      sources: [{ sourceId: "SRC-1", amountUsed: 3 }],
      completedTasks: [],
    };

    const plans = buildExtractionBatchSourceRestorePlans(batch, store);
    expect(plans).toHaveLength(1);
    expect(plans[0].updatedSource.remainingAmount).toBe(3);
    expect(plans[0].updatedSource.status).toBe("Partially Used in Extraction");

    applyExtractionBatchSourceRestorePlansToStore(store, plans);
    expect(store.completedSourceBatches).toHaveLength(0);
    expect(store.sourceBatches).toHaveLength(1);
    expect((store.sourceBatches[0] as { status?: string }).status).toBe(
      "Partially Used in Extraction",
    );
  });

  it("returns fully depleted source to Available for Extraction", () => {
    const store = {
      sourceBatches: [
        {
          id: "SRC-2",
          weightLbs: 5,
          remainingAmount: 0,
          status: "Used in Extraction",
        },
      ],
      completedSourceBatches: [],
      productionBatches: [],
    };

    const plans = buildExtractionBatchSourceRestorePlans(
      {
        id: "EXT-2",
        sources: [{ sourceId: "SRC-2", amountUsed: 5 }],
        completedTasks: [],
      },
      store,
    );

    expect(plans[0].updatedSource.remainingAmount).toBe(5);
    expect(plans[0].updatedSource.status).toBe("Available for Extraction");
  });
});
