import { describe, expect, it } from "vitest";
import {
  extractionBatchBiomassLbs,
  extractionBatchOilGrams,
  extractionCombineUsesOilGrams,
  findExtractionCombineMergeDataForPair,
  filterActiveExtractionBatches,
  findMergedExtractionPartnerBatch,
  isExtractionBatchActiveForCombine,
  isExtractionBatchMergedAbsorbed,
  sweepMergedExtractionBatchesToCompleted,
  mergeExtractionSourceRows,
  rebuildExtractionBatchSourceSummary,
  resolveAbsorbedForUncombine,
  extractionBatchPutPayloadAfterUncombinePartner,
  extractionBatchPutPayloadAfterUncombineSurvivor,
  getExtractionCombinedPartnerIds,
  mergeExtractionPollState,
  setExtractionBatchCombinedOilGrams,
  setExtractionBatchTotalBiomassLbs,
  subtractExtractionSourceRows,
} from "@/lib/extractionMergeHelpers";

describe("extractionMergeHelpers", () => {
  it("mergeExtractionSourceRows sums duplicate source ids", () => {
    const merged = mergeExtractionSourceRows(
      [{ sourceId: "A", amountUsed: 10, name: "Blue" }],
      [{ sourceId: "A", amountUsed: 5, name: "Blue" }, { sourceId: "B", amountUsed: 3, name: "OG" }],
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((r) => r.sourceId === "A")?.amountUsed).toBe(15);
    expect(merged.find((r) => r.sourceId === "B")?.amountUsed).toBe(3);
  });

  it("subtractExtractionSourceRows removes depleted sources", () => {
    const left = subtractExtractionSourceRows(
      [
        { sourceId: "A", amountUsed: 15 },
        { sourceId: "B", amountUsed: 3 },
      ],
      [{ sourceId: "A", amountUsed: 5 }],
    );
    expect(left).toHaveLength(2);
    expect(left.find((r) => r.sourceId === "A")?.amountUsed).toBe(10);
  });

  it("rebuildExtractionBatchSourceSummary updates biomass fields", () => {
    const batch: any = {};
    rebuildExtractionBatchSourceSummary(batch, [
      { sourceId: "X", amountUsed: 12.5, name: "Strain" },
    ]);
    expect(batch.totalBiomassUsed).toBe(12.5);
    expect(batch.amount).toBe("12.5 lbs");
    expect(batch.sourceBlendLabel).toBe("Strain");
  });

  it("findMergedExtractionPartnerBatch locates partner in active or completed lists", () => {
    const partner = {
      id: "P",
      mergedIntoBatchId: "S",
      status: "Merged - Complete",
    };
    expect(
      findMergedExtractionPartnerBatch("P", "S", [partner], []).storage,
    ).toBe("active");
    expect(
      findMergedExtractionPartnerBatch("P", "S", [], [partner]).storage,
    ).toBe("completed");
    expect(findMergedExtractionPartnerBatch("P", "S", [], [])).toBeNull();
  });

  it("sweepMergedExtractionBatchesToCompleted moves merged rows out of active", () => {
    const store: any = {
      extractionBatches: [
        { id: "A", status: "Purge Active" },
        { id: "P", status: "Merged - Complete", mergedIntoBatchId: "S" },
      ],
      completedExtractionBatches: [],
    };
    sweepMergedExtractionBatchesToCompleted(store);
    expect(store.extractionBatches.map((b: any) => b.id)).toEqual(["A"]);
    expect(store.completedExtractionBatches.map((b: any) => b.id)).toEqual(["P"]);
  });

  it("filterActiveExtractionBatches excludes merged partners", () => {
    const rows = [
      { id: "A", status: "Purge Active" },
      { id: "P", status: "Merged - Complete" },
    ];
    expect(filterActiveExtractionBatches(rows).map((b) => b.id)).toEqual(["A"]);
  });

  it("isExtractionBatchMergedAbsorbed detects mergedIntoBatchId", () => {
    expect(isExtractionBatchMergedAbsorbed({ id: "1", mergedIntoBatchId: "S" })).toBe(true);
    expect(isExtractionBatchMergedAbsorbed({ id: "1", status: "Merged - Complete" })).toBe(true);
    expect(isExtractionBatchMergedAbsorbed({ id: "1", status: "Purge Active" })).toBe(false);
  });

  it("isExtractionBatchActiveForCombine rejects finished or merged", () => {
    expect(isExtractionBatchActiveForCombine({ id: "1", status: "Ready For Run Extraction" })).toBe(true);
    expect(
      isExtractionBatchActiveForCombine({
        id: "2",
        status: "Finished - Sent To Packaging",
        completedTasks: ["Finish Batch"],
      }),
    ).toBe(false);
    expect(isExtractionBatchActiveForCombine({ id: "3", mergedIntoBatchId: "S" })).toBe(false);
  });

  it("findExtractionCombineMergeDataForPair matches survivor and absorbed ids", () => {
    const logs = [
      {
        task: "Combine Batches",
        data: {
          combineBatches: true,
          survivorBatchId: "SUV",
          absorbedBatchId: "ABS",
          biomassBeforePartner: 8,
          uiStageBucket: "prep",
        },
      },
    ];
    expect(findExtractionCombineMergeDataForPair(logs, "SUV", "ABS")).toMatchObject({
      biomassBeforePartner: 8,
    });
  });

  it("extractionBatchBiomassLbs reads totalBiomassUsed or amount string", () => {
    expect(extractionBatchBiomassLbs({ totalBiomassUsed: 42 })).toBe(42);
    expect(extractionBatchBiomassLbs({ amount: "12.5 lbs" })).toBe(12.5);
  });

  it("setExtractionBatchTotalBiomassLbs updates lbs fields", () => {
    const batch: any = {};
    setExtractionBatchTotalBiomassLbs(batch, 25);
    expect(batch.totalBiomassUsed).toBe(25);
    expect(batch.amount).toBe("25 lbs");
  });

  it("resolveAbsorbedForUncombine prefers snapshot", () => {
    const partner = {
      mergedIntoSnapshot: {
        biomassAbsorbed: 20,
        sourcesSnapshot: [{ sourceId: "A", amountUsed: 20 }],
        statusBeforeMerge: "Ready For Pack Socks Start",
        uiStageBeforeMerge: "prep",
      },
    };
    expect(resolveAbsorbedForUncombine(partner, [], "S", "P")).toMatchObject({
      biomassLbs: 20,
      combineWeightUnit: "lbs",
      uiStageBeforeMerge: "prep",
    });
  });

  it("extractionCombineUsesOilGrams is true after Run Extraction", () => {
    expect(
      extractionCombineUsesOilGrams({
        completedTasks: ["Pack Socks Start", "Pack Socks Stop", "Run Extraction"],
      }),
    ).toBe(true);
    expect(
      extractionCombineUsesOilGrams({
        completedTasks: ["Pack Socks Start", "Pack Socks Stop"],
      }),
    ).toBe(false);
  });

  it("extractionBatchOilGrams and setExtractionBatchCombinedOilGrams", () => {
    const batch: any = { finalOilGrams: 12.5, extraTerpsGrams: 2 };
    expect(extractionBatchOilGrams(batch)).toBe(12.5);
    setExtractionBatchCombinedOilGrams(batch, 30);
    expect(batch.finalOilGrams).toBe(30);
    expect(batch.totalFinalGrams).toBe(32);
  });

  it("extractionBatchPutPayloadAfterUncombinePartner sends null merge clears", () => {
    const payload = extractionBatchPutPayloadAfterUncombinePartner({
      id: "P",
      status: "Purge Active",
    });
    expect(payload.mergedIntoBatchId).toBeNull();
    expect(payload.mergedIntoSnapshot).toBeNull();
    expect(payload.completedAt).toBeNull();
    expect(JSON.stringify(payload)).toContain('"mergedIntoBatchId":null');
  });

  it("extractionBatchPutPayloadAfterUncombineSurvivor clears empty combinedFromBatchIds", () => {
    const payload = extractionBatchPutPayloadAfterUncombineSurvivor({
      id: "S",
      combinedFromBatchIds: [],
    });
    expect(payload.combinedFromBatchIds).toBeNull();
  });

  it("mergeExtractionPollState keeps local uncombine when server still merged", () => {
    const server = {
      id: "P",
      mergedIntoBatchId: "S",
      status: "Merged - Complete",
      totalBiomassUsed: 0,
    };
    const local = {
      id: "P",
      status: "Purge Active",
      totalBiomassUsed: 12,
      sources: [{ sourceId: "A", amountUsed: 12 }],
    };
    const merged = mergeExtractionPollState(server, local);
    expect(merged.mergedIntoBatchId).toBeUndefined();
    expect(merged.status).toBe("Purge Active");
    expect(merged.totalBiomassUsed).toBe(12);
  });

  it("mergeExtractionPollState keeps survivor with fewer combined partners", () => {
    const server = {
      id: "S",
      combinedFromBatchIds: ["P1", "P2"],
      totalBiomassUsed: 30,
    };
    const local = {
      id: "S",
      combinedFromBatchIds: ["P2"],
      totalBiomassUsed: 20,
    };
    const merged = mergeExtractionPollState(server, local);
    expect(getExtractionCombinedPartnerIds(merged)).toEqual(["P2"]);
    expect(merged.totalBiomassUsed).toBe(20);
  });

  it("resolveAbsorbedForUncombine resolves oil from grams merge log", () => {
    const partner = {
      mergedIntoSnapshot: {
        combineWeightUnit: "grams",
        oilAbsorbed: 79.3,
        biomassAbsorbed: 59.4,
        sourcesSnapshot: [],
        statusBeforeMerge: "Purge Active",
        uiStageBeforeMerge: "post",
      },
    };
    expect(resolveAbsorbedForUncombine(partner, [], "S", "P")).toMatchObject({
      combineWeightUnit: "grams",
      oilGrams: 79.3,
      uiStageBeforeMerge: "post",
    });
  });
});
