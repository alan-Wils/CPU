import { describe, expect, it } from "vitest";
import { planPectinSingleAdditiveBatch } from "./ediblesPectinFormula";
import { buildSnapshotFromSingle, mergeUserNotesAndPectinPlan } from "./ediblesPectinBatchNotes";

describe("mergeUserNotesAndPectinPlan", () => {
  it("keeps user + ingredient notes first, then pectin block with JSON", () => {
    const plan = planPectinSingleAdditiveBatch({
      batchSizeGrams: 1000,
      potencyFraction: 0.8,
      targetMgPerPiece: 10,
      gramsPerPiece: 3.5,
    });
    const snap = buildSnapshotFromSingle({
      input: {
        batchSizeGrams: 1000,
        potencyFraction: 0.8,
        targetMgPerPiece: 10,
        gramsPerPiece: 3.5,
      },
      plan,
      oilInputGrams: 12.5,
      targetPieces: 250,
      lineWasteFraction: 0.05,
    });
    const user = "Line 1 note\n\nIngredients: cocoa butter trace";
    const merged = mergeUserNotesAndPectinPlan(user, snap);
    expect(merged.startsWith(user)).toBe(true);
    expect(merged).toContain("---");
    expect(merged).toContain("Pectin Melt Formula Plan");
    expect(merged).toContain("JSON:");
    expect(merged).toContain('"formulaVersion":"pectin-melt-v1"');
    expect(merged).toContain('"oilInputGrams":12.5');
    expect(merged).toContain('"targetPieces":250');
  });
});
