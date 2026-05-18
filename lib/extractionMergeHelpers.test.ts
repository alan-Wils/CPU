import { describe, expect, it } from "vitest";
import {
  extractionBatchBiomassLbs,
  findExtractionCombineMergeDataForPair,
  isExtractionBatchActiveForCombine,
  mergeExtractionSourceRows,
  rebuildExtractionBatchSourceSummary,
  resolveAbsorbedBiomassForUncombine,
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

  it("resolveAbsorbedBiomassForUncombine prefers snapshot", () => {
    const partner = {
      mergedIntoSnapshot: {
        biomassAbsorbed: 20,
        sourcesSnapshot: [{ sourceId: "A", amountUsed: 20 }],
        statusBeforeMerge: "Ready For Pack Socks Start",
        uiStageBeforeMerge: "prep",
      },
    };
    expect(resolveAbsorbedBiomassForUncombine(partner, [], "S", "P")).toMatchObject({
      biomassLbs: 20,
      uiStageBeforeMerge: "prep",
    });
  });
});
