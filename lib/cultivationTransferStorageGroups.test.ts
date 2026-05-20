import { describe, expect, it } from "vitest";
import {
  groupTransfersByStorage,
  UNASSIGNED_STORAGE_GROUP_ID,
} from "./cultivationTransferStorageGroups";
import type { CultivationExtractionTransferRow } from "@/lib/cultivationTransferApi";

function row(
  partial: Partial<CultivationExtractionTransferRow> & { id: string },
): CultivationExtractionTransferRow {
  return {
    id: partial.id,
    materialType: partial.materialType ?? "FRESH_FROZEN",
    transferStatus: "READY_TO_TRANSFER",
    sourceCultivationBatchId: "B1",
    sourceDryFlowerBatchId: null,
    sourceEventType: null,
    sourceEventAt: null,
    storageType: null,
    storageLocationId: partial.storageLocationId ?? null,
    storageLocationName: partial.storageLocationName ?? null,
    displayName: partial.displayName ?? partial.id,
    harvestCode: null,
    metrcTag: partial.metrcTag ?? null,
    parentGroupId: null,
    weightLbs: null,
    grams: partial.grams ?? 100,
    bundles: 1,
    materialPayload: null,
    extractionSourceBatchId: null,
    transferredAt: null,
    transferredByUserId: null,
    createdAt: "",
    updatedAt: "",
  };
}

describe("groupTransfersByStorage", () => {
  const locations = [
    { id: "freezer-1", name: "Freezer 1" },
    { id: "freezer-2", name: "Freezer 2" },
  ];

  it("groups by storage and sorts in config order with unassigned last", () => {
    const groups = groupTransfersByStorage(
      [
        row({ id: "a", storageLocationId: "freezer-2", storageLocationName: "Freezer 2" }),
        row({ id: "b", storageLocationId: "freezer-1", storageLocationName: "Freezer 1" }),
        row({ id: "c" }),
        row({ id: "d", storageLocationId: "freezer-1", storageLocationName: "Freezer 1" }),
      ],
      locations,
      {},
    );
    expect(groups.map((g) => g.id)).toEqual(["freezer-1", "freezer-2", UNASSIGNED_STORAGE_GROUP_ID]);
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[1].rows).toHaveLength(1);
    expect(groups[2].rows).toHaveLength(1);
  });

  it("uses pending storage edits for grouping", () => {
    const groups = groupTransfersByStorage(
      [row({ id: "a", storageLocationId: "freezer-1" })],
      locations,
      { a: "freezer-2" },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("freezer-2");
  });
});
