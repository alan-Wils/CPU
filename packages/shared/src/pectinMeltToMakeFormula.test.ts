import { describe, expect, it } from "vitest";
import {
  additiveMassFractionFromGoals,
  computeMctFromPartABase,
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
    expect(plan.gramsMctCarrier).toBe(0);
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

  it("MCT carrier % is a percent of Part A base grams", () => {
    const blend = computeMctFromPartABase(10_000, 2, 36);
    expect(blend.gramsMctCarrier).toBeCloseTo(200, 2);
    expect(blend.gramsTotalInfusedOilBlend).toBeCloseTo(236, 2);
  });

  it("single-additive MCT: doses from base + MCT mass (example 10,000g base @ 2%)", () => {
    const plan = planPectinSingleAdditiveBatch({
      batchSizeGrams: 10_200,
      basePartAGrams: 10_000,
      mctCarrierPercent: 2,
      potencyFraction: 0.7933,
      targetMgPerPiece: 10,
      gramsPerPiece: 3.5,
    });
    expect(plan.gramsPartAPectin).toBe(10_000);
    expect(plan.gramsMctCarrier).toBeCloseTo(200, 2);
    expect(plan.finalDosingBatchGrams).toBeCloseTo(10_200, 2);
    expect(plan.nominalPieces).toBeCloseTo(10_200 / 3.5, 2);
    const expectedOil = (plan.nominalPieces * 10) / (0.7933 * 1000);
    expect(plan.gramsAdditive).toBeCloseTo(expectedOil, 1);
    expect(plan.gramsTotalInfusedOilBlend).toBeCloseTo(expectedOil + 200, 1);

    const withoutMct = planPectinSingleAdditiveBatch({
      batchSizeGrams: 10_000,
      potencyFraction: 0.7933,
      targetMgPerPiece: 10,
      gramsPerPiece: 3.5,
    });
    expect(plan.gramsAdditive).toBeGreaterThan(withoutMct.gramsAdditive);
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
