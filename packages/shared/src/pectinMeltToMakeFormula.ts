/**
 * Melt-to-Make™ pectin gummy formula math aligned with the official
 * "Melt-to-Make_Pectin_Formula_Calculator" workbook (single / multi additive sheets).
 *
 * Potency is expressed as a fraction (e.g. 0.7933 for 79.33% on a COA).
 */

const g = (n: number) => Number(Number(n).toFixed(6));

export type PectinSingleAdditiveInput = {
  batchSizeGrams: number;
  /** Lab / COA potency of the active additive as a 0–1 fraction (not percent). */
  potencyFraction: number;
  targetMgPerPiece: number;
  gramsPerPiece: number;
  /** Part B citric solution as a fraction of total formula (workbook default 1.4%). */
  citricMassFraction?: number;
  /** Line loss applied to nominal piece count (workbook uses 5% → 0.95). */
  lineWasteFraction?: number;
  /**
   * Optional MCT carrier as % of calculated cannabis oil grams (e.g. 5 = 5%).
   * Does not change dose math or Part A balance.
   */
  mctCarrierPercent?: number;
};

export type PectinMctCarrierBlend = {
  gramsCannabisOil: number;
  gramsMctCarrier: number;
  gramsTotalInfusedOilBlend: number;
};

export type PectinSingleAdditivePlan = {
  additiveMassFraction: number;
  citricMassFraction: number;
  partAPectinMassFraction: number;
  gramsPartAPectin: number;
  /** Cannabis oil required for target dose (same as pre-MCT `gramsAdditive`). */
  gramsAdditive: number;
  gramsMctCarrier: number;
  gramsTotalInfusedOilBlend: number;
  mctCarrierPercent?: number;
  gramsCitricSolution: number;
  gramsTotalCheck: number;
  nominalPieces: number;
  piecesAfterLineWaste: number;
  additiveMassFractionPct: number;
  warnings: string[];
};

/**
 * Active additive load as a mass fraction of the full batch (matches Excel C26 on single-additive tab):
 * goalMgPerPiece / (potencyFraction * gramsPerPiece * 1000)
 */
export function additiveMassFractionFromGoals(input: {
  targetMgPerPiece: number;
  potencyFraction: number;
  gramsPerPiece: number;
}): number {
  const { targetMgPerPiece, potencyFraction, gramsPerPiece } = input;
  if (potencyFraction <= 0 || gramsPerPiece <= 0) {
    throw new RangeError("potencyFraction and gramsPerPiece must be positive");
  }
  return g(targetMgPerPiece / (potencyFraction * gramsPerPiece * 1000));
}

/** Workbook "GUMMY WEIGHT CALCULATOR": Estimated Piece Weight = moldMl * 1.34 */
export function estimatedGummyWeightGramsFromMoldMl(moldMl: number, densityFactor = 1.34): number {
  if (moldMl <= 0) throw new RangeError("moldMl must be positive");
  return g(moldMl * densityFactor);
}

/**
 * MCT carrier is a % of calculated cannabis oil only (not batch %, not potency dilution).
 * Omit or pass ≤0 for no carrier — returns cannabis oil only with zero MCT.
 */
export function computeMctCarrierBlend(
  gramsCannabisOil: number,
  mctCarrierPercent?: number,
): PectinMctCarrierBlend {
  const oil = g(gramsCannabisOil);
  const pct = mctCarrierPercent ?? 0;
  if (!Number.isFinite(pct) || pct <= 0) {
    return { gramsCannabisOil: oil, gramsMctCarrier: 0, gramsTotalInfusedOilBlend: oil };
  }
  if (pct > 1000) throw new RangeError("mctCarrierPercent must be reasonable (≤ 1000)");
  const gramsMctCarrier = g(oil * (pct / 100));
  return {
    gramsCannabisOil: oil,
    gramsMctCarrier,
    gramsTotalInfusedOilBlend: g(oil + gramsMctCarrier),
  };
}

export function planPectinSingleAdditiveBatch(raw: PectinSingleAdditiveInput): PectinSingleAdditivePlan {
  const batchSizeGrams = g(raw.batchSizeGrams);
  const citricMassFraction = g(raw.citricMassFraction ?? 0.014);
  const lineWasteFraction = raw.lineWasteFraction ?? 0.05;

  if (batchSizeGrams <= 0) throw new RangeError("batchSizeGrams must be positive");
  if (lineWasteFraction < 0 || lineWasteFraction >= 1) throw new RangeError("lineWasteFraction must be in [0, 1)");

  const additiveMassFraction = additiveMassFractionFromGoals({
    targetMgPerPiece: raw.targetMgPerPiece,
    potencyFraction: raw.potencyFraction,
    gramsPerPiece: raw.gramsPerPiece,
  });

  const partAPectinMassFraction = g(1 - additiveMassFraction - citricMassFraction);

  const warnings: string[] = [];
  if (additiveMassFraction > 0.04) {
    warnings.push(
      "Total additive fraction is above 4% of formula — Melt-to-Make recommends staying under 4% for best results.",
    );
  }
  if (partAPectinMassFraction <= 0) {
    warnings.push("Part A pectin base fraction is zero or negative — batch inputs are not feasible.");
  }

  const gramsPartAPectin = g(partAPectinMassFraction * batchSizeGrams);
  const gramsAdditive = g(additiveMassFraction * batchSizeGrams);
  const gramsCitricSolution = g(citricMassFraction * batchSizeGrams);
  const gramsTotalCheck = g(gramsPartAPectin + gramsAdditive + gramsCitricSolution);

  const nominalPieces = g(batchSizeGrams / raw.gramsPerPiece);
  const piecesAfterLineWaste = g(nominalPieces * (1 - lineWasteFraction));

  const oilBlend = computeMctCarrierBlend(gramsAdditive, raw.mctCarrierPercent);

  return {
    additiveMassFraction,
    citricMassFraction,
    partAPectinMassFraction,
    gramsPartAPectin,
    gramsAdditive: oilBlend.gramsCannabisOil,
    gramsMctCarrier: oilBlend.gramsMctCarrier,
    gramsTotalInfusedOilBlend: oilBlend.gramsTotalInfusedOilBlend,
    mctCarrierPercent:
      raw.mctCarrierPercent != null && raw.mctCarrierPercent > 0 ? g(raw.mctCarrierPercent) : undefined,
    gramsCitricSolution,
    gramsTotalCheck,
    nominalPieces,
    piecesAfterLineWaste,
    additiveMassFractionPct: g(additiveMassFraction * 100),
    warnings,
  };
}

export type PectinAdditiveLineInput = {
  goalMgPerPiece: number;
  potencyFraction: number;
};

export type PectinMultiAdditiveInput = {
  batchSizeGrams: number;
  gramsPerPiece: number;
  additives: PectinAdditiveLineInput[];
  citricMassFraction?: number;
  /** Fixed mass fractions (flavor, color, enhancer, etc.) summed like extra rows in the workbook. */
  extraMassFractions?: number[];
  lineWasteFraction?: number;
  /** MCT carrier as % of combined calculated cannabis oil grams. */
  mctCarrierPercent?: number;
};

export type PectinMultiAdditivePlan = {
  additiveMassFractions: number[];
  extraMassFraction: number;
  citricMassFraction: number;
  partAPectinMassFraction: number;
  gramsByLine: { partAPectin: number; additives: number[]; extras: number[]; citric: number; total: number };
  gramsMctCarrier: number;
  gramsTotalInfusedOilBlend: number;
  mctCarrierPercent?: number;
  nominalPieces: number;
  piecesAfterLineWaste: number;
  totalAdditiveMassFractionPct: number;
  warnings: string[];
};

export function planPectinMultiAdditiveBatch(raw: PectinMultiAdditiveInput): PectinMultiAdditivePlan {
  const batchSizeGrams = g(raw.batchSizeGrams);
  const citricMassFraction = g(raw.citricMassFraction ?? 0.014);
  const lineWasteFraction = raw.lineWasteFraction ?? 0.05;
  const extras = (raw.extraMassFractions ?? []).map((x) => g(x));
  const extraSum = g(extras.reduce((s, x) => s + x, 0));

  if (batchSizeGrams <= 0) throw new RangeError("batchSizeGrams must be positive");
  if (!raw.additives.length) throw new RangeError("At least one additive line is required");

  const additiveMassFractions = raw.additives.map((line) =>
    additiveMassFractionFromGoals({
      targetMgPerPiece: line.goalMgPerPiece,
      potencyFraction: line.potencyFraction,
      gramsPerPiece: raw.gramsPerPiece,
    }),
  );
  const additivesSum = g(additiveMassFractions.reduce((s, x) => s + x, 0));
  const partAPectinMassFraction = g(1 - additivesSum - extraSum - citricMassFraction);

  const warnings: string[] = [];
  const totalAdditivePct = g(additivesSum * 100);
  if (additivesSum > 0.04) {
    warnings.push(
      "Combined additive fractions exceed 4% of formula — Melt-to-Make recommends staying under 4% for most SKUs.",
    );
  }
  if (partAPectinMassFraction <= 0) {
    warnings.push("Part A pectin base fraction is zero or negative — reduce additives, extras, or citric %.");
  }

  const gramsAdditives = additiveMassFractions.map((f) => g(f * batchSizeGrams));
  const gramsExtras = extras.map((f) => g(f * batchSizeGrams));
  const gramsCitric = g(citricMassFraction * batchSizeGrams);
  const gramsPartA = g(partAPectinMassFraction * batchSizeGrams);
  const total = g(gramsPartA + gramsAdditives.reduce((a, b) => a + b, 0) + gramsExtras.reduce((a, b) => a + b, 0) + gramsCitric);

  const nominalPieces = g(batchSizeGrams / raw.gramsPerPiece);
  const piecesAfterLineWaste = g(nominalPieces * (1 - lineWasteFraction));

  const gramsCannabisOilCombined = g(gramsAdditives.reduce((a, b) => a + b, 0));
  const oilBlend = computeMctCarrierBlend(gramsCannabisOilCombined, raw.mctCarrierPercent);

  return {
    additiveMassFractions,
    extraMassFraction: extraSum,
    citricMassFraction,
    partAPectinMassFraction,
    gramsByLine: {
      partAPectin: gramsPartA,
      additives: gramsAdditives,
      extras: gramsExtras,
      citric: gramsCitric,
      total,
    },
    gramsMctCarrier: oilBlend.gramsMctCarrier,
    gramsTotalInfusedOilBlend: oilBlend.gramsTotalInfusedOilBlend,
    mctCarrierPercent:
      raw.mctCarrierPercent != null && raw.mctCarrierPercent > 0 ? g(raw.mctCarrierPercent) : undefined,
    nominalPieces,
    piecesAfterLineWaste,
    totalAdditiveMassFractionPct: totalAdditivePct,
    warnings,
  };
}
