import { describe, expect, it } from "vitest";
import {
  applyExtractionSurvivorCombinedTotals,
  extractionBatchBiomassGrams,
  extractionBatchBiomassLbs,
  extractionBatchOilGrams,
  extractionCombineUsesOilGrams,
  extractionCombineWeightGramsForBatch,
  sumExtractionCombineWeightGrams,
  findExtractionCombineMergeDataForPair,
  filterActiveExtractionBatches,
  findMergedExtractionPartnerBatch,
  isExtractionBatchActiveForCombine,
  extractionBatchPutPayloadForDetailEdit,
  isExtractionBatchMergedAbsorbed,
  sanitizeExtractionBatchMergeState,
  sweepMergedExtractionBatchesToCompleted,
  mergeExtractionSourceRows,
  rebuildExtractionBatchSourceSummary,
  resolveExtractionBatchSourceRows,
  resolveAbsorbedForUncombine,
  applyExtractionPartnerUncombineRestore,
  applyPrunedCombinedFromBatchIds,
  applyExtractionPreMergeUiSnapshot,
  captureExtractionPreMergeUiSnapshot,
  extractionBatchPutPayloadAfterUncombinePartner,
  extractionBatchPutPayloadAfterUncombineSurvivor,
  getExtractionCombinedPartnerIds,
  getValidatedCombinedPartnerIds,
  isPartnerMergedIntoSurvivor,
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

  it("getValidatedCombinedPartnerIds drops phantom links to active partners", () => {
    const survivor = {
      id: "EXT-S",
      combinedFromBatchIds: ["EXT-P"],
      status: "Purge Active",
    };
    const partner = {
      id: "EXT-P",
      status: "Purge Active",
      marketBatchCode: "GMO.051226",
    };
    expect(isPartnerMergedIntoSurvivor(partner, "EXT-S")).toBe(false);
    expect(
      getValidatedCombinedPartnerIds(survivor, [survivor, partner], []),
    ).toEqual([]);
    expect(applyPrunedCombinedFromBatchIds(survivor, [survivor, partner], [])).toBe(
      true,
    );
    expect(survivor.combinedFromBatchIds).toBeUndefined();
  });

  it("getValidatedCombinedPartnerIds keeps truly merged partners", () => {
    const survivor = { id: "S", combinedFromBatchIds: ["P"] };
    const partner = {
      id: "P",
      mergedIntoBatchId: "S",
      status: "Merged - Complete",
    };
    expect(getValidatedCombinedPartnerIds(survivor, [], [partner])).toEqual(["P"]);
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

  it("isExtractionBatchMergedAbsorbed requires merged status when mergedIntoBatchId is set", () => {
    expect(
      isExtractionBatchMergedAbsorbed({
        id: "1",
        mergedIntoBatchId: "S",
        status: "Merged - Complete",
      }),
    ).toBe(true);
    expect(
      isExtractionBatchMergedAbsorbed({
        id: "1",
        mergedIntoBatchId: "S",
        status: "Purge Active",
      }),
    ).toBe(false);
    expect(isExtractionBatchMergedAbsorbed({ id: "EXT-1", mergedIntoBatchId: "EXT-1" })).toBe(
      false,
    );
    expect(isExtractionBatchMergedAbsorbed({ id: "1", status: "Merged - Complete" })).toBe(true);
    expect(isExtractionBatchMergedAbsorbed({ id: "1", status: "Purge Active" })).toBe(false);
  });

  it("sanitizeExtractionBatchMergeState strips stale merge markers on active batches", () => {
    expect(
      sanitizeExtractionBatchMergeState({
        id: "EXT-A",
        mergedIntoBatchId: "EXT-B",
        status: "Purge Active",
      }).mergedIntoBatchId,
    ).toBeUndefined();
    expect(
      sanitizeExtractionBatchMergeState({
        id: "EXT-A",
        mergedIntoBatchId: "EXT-A",
        status: "Purge Active",
      }).mergedIntoBatchId,
    ).toBeUndefined();
    expect(
      sanitizeExtractionBatchMergeState({
        id: "P",
        mergedIntoBatchId: "S",
        status: "Merged - Complete",
      }).mergedIntoBatchId,
    ).toBe("S");
  });

  it("extractionBatchPutPayloadForDetailEdit clears merge fields for active batches", () => {
    const payload = extractionBatchPutPayloadForDetailEdit({
      id: "EXT-A",
      status: "Purge Active",
      mergedIntoBatchId: "EXT-B",
      marketBatchCode: "GMO.051226",
    });
    expect(payload.mergedIntoBatchId).toBeNull();
    expect(payload.marketBatchCode).toBe("GMO.051226");
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
    expect(
      isExtractionBatchActiveForCombine({
        id: "3",
        mergedIntoBatchId: "S",
        status: "Merged - Complete",
      }),
    ).toBe(false);
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

  it("extractionBatchBiomassLbs parses comma grams in amount when totalBiomassUsed missing", () => {
    expect(
      extractionBatchBiomassLbs({ amount: "19,822 g" }),
    ).toBeCloseTo(19822 / 453.592, 2);
  });

  it("extractionBatchBiomassLbs falls back to inputGrams", () => {
    expect(extractionBatchBiomassLbs({ inputGrams: 4535.92 })).toBeCloseTo(10, 2);
  });

  it("sumExtractionCombineWeightGrams adds biomass from both batches", () => {
    const survivor = { totalBiomassUsed: 43.7 };
    const partner = { totalBiomassUsed: 48.65 };
    const { totalGrams } = sumExtractionCombineWeightGrams(survivor, partner, false);
    expect(totalGrams).toBeCloseTo(41889, 0);
  });

  it("sumExtractionCombineWeightGrams adds oil after Run Extraction", () => {
    const survivor = { finalOilGrams: 100, completedTasks: ["Run Extraction"] };
    const partner = { finalOilGrams: 250, completedTasks: ["Run Extraction"] };
    expect(sumExtractionCombineWeightGrams(survivor, partner, true).totalGrams).toBe(350);
  });

  it("applyExtractionSurvivorCombinedTotals sets combined biomass on survivor", () => {
    const survivor: any = { totalBiomassUsed: 43.7 };
    const partner: any = { totalBiomassUsed: 48.65 };
    const { totalGrams } = sumExtractionCombineWeightGrams(survivor, partner, false);
    applyExtractionSurvivorCombinedTotals(survivor, partner, totalGrams, false);
    expect(extractionBatchBiomassGrams(survivor)).toBe(totalGrams);
  });

  it("extractionCombineWeightGramsForBatch uses oil when post-extraction", () => {
    const batch = { finalOilGrams: 88, totalBiomassUsed: 40, completedTasks: ["Run Extraction"] };
    expect(extractionCombineWeightGramsForBatch(batch, true)).toBe(88);
    expect(extractionCombineWeightGramsForBatch(batch, false)).toBeGreaterThan(0);
  });

  it("extractionBatchBiomassLbs falls back to Pack Socks Stop prepared lbs", () => {
    expect(
      extractionBatchBiomassLbs({
        totalBiomassUsed: 0,
        taskData: { "Pack Socks Stop": { totalPreparedLbs: 59.45 } },
      }),
    ).toBe(59.45);
  });

  it("resolveExtractionBatchSourceRows rebuilds from comma-separated source ids", () => {
    const rows = resolveExtractionBatchSourceRows({
      source: "GMO.051226, FF-GMO.020926",
      totalBiomassUsed: 100,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].amountUsed).toBe(50);
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

  it("captureExtractionPreMergeUiSnapshot stores biomass and oil totals", () => {
    const snap = captureExtractionPreMergeUiSnapshot({
      totalBiomassUsed: 40,
      amount: "40 lbs",
      finalOilGrams: 360,
      totalFinalGrams: 360,
      completedTasks: ["Run Extraction"],
    });
    expect(snap.totalBiomassUsed).toBe(40);
    expect(snap.finalOilGrams).toBe(360);
    expect(snap.completedTasks).toEqual(["Run Extraction"]);
  });

  it("applyExtractionPartnerUncombineRestore uses preMergeUiSnapshot", () => {
    const partner: any = {
      id: "P",
      totalBiomassUsed: 0,
      amount: "0 lbs",
      mergedIntoSnapshot: {
        preMergeUiSnapshot: {
          totalBiomassUsed: 39.6,
          amount: "39.6 lbs",
          finalOilGrams: 359.5,
          totalFinalGrams: 359.5,
        },
        biomassAbsorbed: 39.6,
        oilAbsorbed: 359.5,
        combineWeightUnit: "grams",
      },
    };
    applyExtractionPartnerUncombineRestore(partner, {
      biomassLbs: 39.6,
      oilGrams: 359.5,
      combineWeightUnit: "grams",
      sources: [],
      statusBeforeMerge: "Purge Active",
      uiStageBeforeMerge: "post",
    });
    expect(partner.totalBiomassUsed).toBe(39.6);
    expect(partner.finalOilGrams).toBe(359.5);
    expect(partner.totalFinalGrams).toBe(359.5);
  });

  it("applyExtractionPartnerUncombineRestore falls back to oil from merge log", () => {
    const partner: any = { id: "P", mergedIntoSnapshot: { combineWeightUnit: "grams" } };
    applyExtractionPartnerUncombineRestore(partner, {
      biomassLbs: 20,
      oilGrams: 180,
      combineWeightUnit: "grams",
      sources: [],
      statusBeforeMerge: "Purge Active",
      uiStageBeforeMerge: "post",
    });
    expect(extractionBatchOilGrams(partner)).toBe(180);
    expect(extractionBatchBiomassLbs(partner)).toBe(20);
  });

  it("mergeExtractionPollState prefers local totals over server zeros after uncombine", () => {
    const server = {
      id: "P",
      status: "Purge Active",
      totalBiomassUsed: 0,
      amount: "0 lbs",
      totalFinalGrams: 0,
    };
    const local = {
      id: "P",
      status: "Purge Active",
      totalBiomassUsed: 39.6,
      amount: "39.6 lbs",
      totalFinalGrams: 359.5,
      finalOilGrams: 359.5,
    };
    const merged = mergeExtractionPollState(server, local);
    expect(merged.totalBiomassUsed).toBe(39.6);
    expect(merged.totalFinalGrams).toBe(359.5);
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

  it("mergeExtractionPollState drops stale local merge markers when server row is active", () => {
    const server = {
      id: "EXT-A",
      status: "Purge Active",
      marketBatchCode: "GMO.051226",
    };
    const local = {
      id: "EXT-A",
      status: "Purge Active",
      mergedIntoBatchId: "EXT-A",
      marketBatchCode: "GMO.051226",
    };
    const merged = mergeExtractionPollState(server, local);
    expect(merged.mergedIntoBatchId).toBeUndefined();
    expect(merged.status).toBe("Purge Active");
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
