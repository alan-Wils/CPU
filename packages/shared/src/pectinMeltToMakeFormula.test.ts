import { describe, expect, it } from "vitest";
import {
  additiveMassFractionFromGoals,
  estimatedGummyWeightGramsFromMoldMl,
  planPectinMultiAdditiveBatch,
  planPectinSingleAdditiveBatch,
} from "./pectinMeltToMakeFormula.js";

describe("pectinMeltToMakeFormula", () => {
  it("matches workbook single-additive snapshot (batch 10088 g)", () => {
    const plan = planPectinSingleAdditiveBatch({
      batchSizeGrams: 10088,
      potencyFraction: 0.7933,
      targetMgPerPiece: 10,
      gramsPerPiece: 3.5,
    });
    expect(plan.gramsPartAPectin).toBeCloseTo(9910, 0);
    expect(plan.additiveMassFraction).toBeCloseTo(10 / (0.7933 * 3.5 * 1000), 6);
    expect(plan.partAPectinMassFraction + plan.additiveMassFraction + plan.citricMassFraction).toBeCloseTo(1, 5);
    expect(plan.piecesAfterLineWaste).toBeCloseTo((10088 / 3.5) * 0.95, 4);
  });

  it("gummy weight calculator: mL × 1.34", () => {
    expect(estimatedGummyWeightGramsFromMoldMl(3)).toBeCloseTo(4.02, 2);
  });

  it("additiveMassFractionFromGoals is stable for fractional potency", () => {
    const f = additiveMassFractionFromGoals({
      targetMgPerPiece: 10,
      potencyFraction: 1,
      gramsPerPiece: 2.68,
    });
    expect(f).toBeCloseTo(10 / (1 * 2.68 * 1000), 5);
  });

  it("multi-additive: four equal 5 mg lines @ 100% potency", () => {
    const plan = planPectinMultiAdditiveBatch({
      batchSizeGrams: 10000,
      gramsPerPiece: 2.68,
      additives: [
        { goalMgPerPiece: 5, potencyFraction: 1 },
        { goalMgPerPiece: 5, potencyFraction: 1 },
        { goalMgPerPiece: 5, potencyFraction: 1 },
        { goalMgPerPiece: 5, potencyFraction: 1 },
      ],
    });
    expect(plan.additiveMassFractions).toHaveLength(4);
    expect(plan.additiveMassFractions[0]).toBeCloseTo(5 / (1 * 2.68 * 1000), 6);
    const sumLines = plan.additiveMassFractions.reduce((a, b) => a + b, 0);
    expect(plan.partAPectinMassFraction).toBeCloseTo(1 - sumLines - plan.citricMassFraction, 5);
  });
});
