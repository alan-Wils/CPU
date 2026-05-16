import { describe, expect, it } from "vitest";
import {
  additiveMassFractionFromGoals,
  computeMctCarrierBlend,
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

  it("MCT carrier % applies to calculated cannabis oil only", () => {
    const blend = computeMctCarrierBlend(36, 5);
    expect(blend.gramsCannabisOil).toBe(36);
    expect(blend.gramsMctCarrier).toBeCloseTo(1.8, 4);
    expect(blend.gramsTotalInfusedOilBlend).toBeCloseTo(37.8, 4);
    expect(computeMctCarrierBlend(36, 0).gramsMctCarrier).toBe(0);
    expect(computeMctCarrierBlend(36).gramsTotalInfusedOilBlend).toBe(36);
  });

  it("single-additive with MCT does not change Part A or cannabis oil dose", () => {
    const base = planPectinSingleAdditiveBatch({
      batchSizeGrams: 10_000,
      potencyFraction: 0.7933,
      targetMgPerPiece: 10,
      gramsPerPiece: 3.5,
    });
    const withMct = planPectinSingleAdditiveBatch({
      batchSizeGrams: 10_000,
      potencyFraction: 0.7933,
      targetMgPerPiece: 10,
      gramsPerPiece: 3.5,
      mctCarrierPercent: 5,
    });
    expect(withMct.gramsAdditive).toBe(base.gramsAdditive);
    expect(withMct.gramsPartAPectin).toBe(base.gramsPartAPectin);
    expect(withMct.gramsMctCarrier).toBeCloseTo(base.gramsAdditive * 0.05, 4);
    expect(withMct.gramsTotalInfusedOilBlend).toBeCloseTo(base.gramsAdditive * 1.05, 4);
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
