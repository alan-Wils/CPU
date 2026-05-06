import { describe, expect, it } from "vitest";
import {
  hydrateDryFlowerBatchesFromLogSnapshots,
  snapshotDryFlowerCardFields,
} from "./dryFlowerLogHydrate";

describe("hydrateDryFlowerBatchesFromLogSnapshots", () => {
  it("replays cultivation log snapshots in chronological order", () => {
    const dryId = "DRY-X-0001";
    const store = {
      logs: [
        {
          area: "Cultivation",
          task: "Trimming",
          time: "2026-05-05T21:12:00.000Z",
          data: {
            dryFlowerCardSnapshot: {
              id: dryId,
              status: "Trimmed",
              trimmedWeightLbs: 35,
              popcornWeightLbs: 5,
            },
          },
        },
        {
          area: "Cultivation",
          task: "Bucking",
          time: "2026-05-05T21:10:00.000Z",
          data: {
            dryFlowerCardSnapshot: {
              id: dryId,
              status: "Bucked",
              buckWholePlantLbs: 50,
              trimmedWeightLbs: "",
            },
          },
        },
      ],
      dryFlowerBatches: [
        {
          id: dryId,
          status: "Bucked",
          buckWholePlantLbs: "",
          trimmedWeightLbs: "",
        },
      ],
      productionBatches: [{ id: dryId, status: "Bucked" }],
    };

    hydrateDryFlowerBatchesFromLogSnapshots(store);

    const row = (store.dryFlowerBatches as any[]).find((b) => b.id === dryId);
    expect(row?.status).toBe("Trimmed");
    expect(row?.buckWholePlantLbs).toBe(50);
    expect(row?.trimmedWeightLbs).toBe(35);
    expect(row?.popcornWeightLbs).toBe(5);

    const prod = (store.productionBatches as any[]).find((p) => p.id === dryId);
    expect(prod?.trimmedWeightLbs).toBe(35);
  });

  it("creates a dry row from logs when the store list is empty", () => {
    const dryId = "DRY-ONLY-LOGS";
    const store = {
      logs: [
        {
          area: "Cultivation",
          time: "2026-01-01T00:00:00.000Z",
          data: {
            dryFlowerCardSnapshot: {
              id: dryId,
              name: "Test Flower",
              status: "Trimmed",
              trimmedWeightLbs: 12,
            },
          },
        },
      ],
      dryFlowerBatches: [] as unknown[],
      productionBatches: [] as unknown[],
    };

    hydrateDryFlowerBatchesFromLogSnapshots(store);

    expect((store.dryFlowerBatches as any[])).toHaveLength(1);
    expect((store.dryFlowerBatches as any[])[0].id).toBe(dryId);
    expect((store.dryFlowerBatches as any[])[0].trimmedWeightLbs).toBe(12);
  });
});

describe("snapshotDryFlowerCardFields", () => {
  it("returns null without id", () => {
    expect(snapshotDryFlowerCardFields(null)).toBeNull();
    expect(snapshotDryFlowerCardFields({})).toBeNull();
  });

  it("clones a plain batch object", () => {
    const b = { id: "DRY-1", trimmedWeightLbs: 3, nested: { a: 1 } };
    const s = snapshotDryFlowerCardFields(b);
    expect(s?.id).toBe("DRY-1");
    expect(s?.nested).toEqual({ a: 1 });
    (b as any).trimmedWeightLbs = 99;
    expect(s?.trimmedWeightLbs).toBe(3);
  });
});
