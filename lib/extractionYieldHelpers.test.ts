import { describe, expect, it } from "vitest";
import {
  computeExtractionYieldMetrics,
  readTotalTerpsCollectedGrams,
  syncExtractionYieldFieldsToBatch,
} from "@/lib/extractionYieldHelpers";

describe("extractionYieldHelpers", () => {
  const batch = {
    totalBiomassUsed: 100,
    taskData: {
      "Finish Terp Separation": { totalTerps: "50" },
    },
  };

  it("computes oil, terp, total, terped, and leftover yields", () => {
    const metrics = computeExtractionYieldMetrics(
      {
        ...batch,
        finalDecarbedOilGrams: 1000,
      },
      10,
    );
    expect(metrics).not.toBeNull();
    expect(metrics!.terpsToAddBackGrams).toBe(100);
    expect(metrics!.actualTerpsAddedBackGrams).toBe(50);
    expect(metrics!.leftoverTerpsGrams).toBe(0);
    expect(metrics!.terpedOilGrams).toBe(1050);
    expect(metrics!.terpAddBackCapped).toBe(true);
    expect(metrics!.oilYieldPercent).toBeCloseTo(2.2, 1);
    expect(metrics!.terpYieldPercent).toBeCloseTo(0.11, 2);
    expect(metrics!.totalBatchYieldPercent).toBeCloseTo(2.31, 1);
  });

  it("never allows negative leftover terps", () => {
    const metrics = computeExtractionYieldMetrics(
      {
        totalBiomassUsed: 10,
        totalTerpsCollectedGrams: 5,
        finalDecarbedOilGrams: 100,
      },
      200,
    );
    expect(metrics!.actualTerpsAddedBackGrams).toBe(5);
    expect(metrics!.leftoverTerpsGrams).toBe(0);
  });

  it("reads terps from task data when root field is missing", () => {
    expect(readTotalTerpsCollectedGrams(batch)).toBe(50);
  });

  it("syncs metrics onto batch root", () => {
    const row: Record<string, unknown> = {
      totalBiomassUsed: 50,
      totalTerpsCollectedGrams: 20,
      finalDecarbedOilGrams: 400,
    };
    syncExtractionYieldFieldsToBatch(row, 5);
    expect(row.terpsToAddBackGrams).toBe(20);
    expect(row.actualTerpsAddedBackGrams).toBe(20);
    expect(row.terpedOilGrams).toBe(420);
    expect(row.totalBatchYieldPercent).toBeGreaterThan(0);
  });
});
