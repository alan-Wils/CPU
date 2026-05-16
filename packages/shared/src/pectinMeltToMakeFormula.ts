/**
 * Melt-to-Make™ pectin gummy formula math aligned with the official
 * "Melt-to-Make_Pectin_Formula_Calculator" workbook (single / multi additive sheets).
 *
 * Potency is expressed as a fraction (e.g. 0.7933 for 79.33% on a COA).
 */

const g = (n: number) => Number(Number(n).toFixed(6));

export type PectinSingleAdditiveInput = {
  /** Full formula batch mass (workbook mode). Ignored for oil math when MCT base mode is active. */
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
   * MCT carrier as % of Part A / base grams (e.g. 2 = 2%). Blank or ≤0 uses workbook batch math only.
   */
  mctCarrierPercent?: number;
  /** Part A on hand (g). Required when `mctCarrierPercent` > 0. */
  basePartAGrams?: number;
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
  /** Cannabis oil required for target dose. */
  gramsAdditive: number;
  gramsMctCarrier: number;
  gramsTotalInfusedOilBlend: number;
  mctCarrierPercent?: number;
  /** Base + MCT mass used for piece count / dosing (excludes oil and citric). */
  finalDosingBatchGrams: number;
  totalActiveMgNeeded: number;
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

function usesMctBaseMode(raw: {
  mctCarrierPercent?: number;
  basePartAGrams?: number;
}): boolean {
  const pct = raw.mctCarrierPercent ?? 0;
  const base = raw.basePartAGrams ?? 0;
  return pct > 0 && base > 0;
}

/**
 * MCT carrier is a % of Part A / base grams. Infused blend = cannabis oil + MCT (computed separately).
 */
export function computeMctFromPartABase(
  basePartAGrams: number,
  mctCarrierPercent: number,
  gramsCannabisOil: number,
): PectinMctCarrierBlend {
  const base = g(basePartAGrams);
  const pct = mctCarrierPercent;
  if (!Number.isFinite(pct) || pct <= 0) {
    const oil = g(gramsCannabisOil);
    return { gramsCannabisOil: oil, gramsMctCarrier: 0, gramsTotalInfusedOilBlend: oil };
  }
  if (pct > 1000) throw new RangeError("mctCarrierPercent must be reasonable (≤ 1000)");
  const gramsMctCarrier = g(base * (pct / 100));
  const oil = g(gramsCannabisOil);
  return {
    gramsCannabisOil: oil,
    gramsMctCarrier,
    gramsTotalInfusedOilBlend: g(oil + gramsMctCarrier),
  };
}

/** @deprecated Use computeMctFromPartABase — kept for callers/tests migrating off oil-% MCT. */
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

function planPectinSingleAdditiveBatchMctBase(raw: PectinSingleAdditiveInput): PectinSingleAdditivePlan {
  const basePartAGrams = g(raw.basePartAGrams!);
  const mctPct = g(raw.mctCarrierPercent!);
  const citricMassFraction = g(raw.citricMassFraction ?? 0.014);
  const lineWasteFraction = raw.lineWasteFraction ?? 0.05;

  if (raw.potencyFraction <= 0 || raw.potencyFraction > 1) {
    throw new RangeError("potencyFraction must be in (0, 1]");
  }
  if (raw.targetMgPerPiece <= 0) throw new RangeError("targetMgPerPiece must be positive");
  if (raw.gramsPerPiece <= 0) throw new RangeError("gramsPerPiece must be positive");
  if (lineWasteFraction < 0 || lineWasteFraction >= 1) throw new RangeError("lineWasteFraction must be in [0, 1)");

  const gramsMctCarrier = g(basePartAGrams * (mctPct / 100));
  const finalDosingBatchGrams = g(basePartAGrams + gramsMctCarrier);
  const nominalPieces = g(finalDosingBatchGrams / raw.gramsPerPiece);
  const piecesAfterLineWaste = g(nominalPieces * (1 - lineWasteFraction));
  const totalActiveMgNeeded = g(nominalPieces * raw.targetMgPerPiece);
  const gramsCannabisOil = g(totalActiveMgNeeded / (raw.potencyFraction * 1000));

  const oilBlend = computeMctFromPartABase(basePartAGrams, mctPct, gramsCannabisOil);

  const nonCitricMass = g(basePartAGrams + gramsMctCarrier + gramsCannabisOil);
  const gramsTotalFormula = g(nonCitricMass / (1 - citricMassFraction));
  const gramsCitricSolution = g(gramsTotalFormula * citricMassFraction);
  const gramsTotalCheck = g(basePartAGrams + gramsMctCarrier + gramsCannabisOil + gramsCitricSolution);

  const additiveMassFraction =
    finalDosingBatchGrams > 0 ? g(gramsCannabisOil / finalDosingBatchGrams) : 0;
  const partAPectinMassFraction =
    gramsTotalFormula > 0 ? g(basePartAGrams / gramsTotalFormula) : 0;

  const warnings: string[] = [];
  if (additiveMassFraction > 0.04) {
    warnings.push(
      "Cannabis oil is above 4% of the dosing batch (base + MCT) — Melt-to-Make recommends staying under 4% for best results.",
    );
  }

  return {
    additiveMassFraction,
    citricMassFraction,
    partAPectinMassFraction,
    gramsPartAPectin: basePartAGrams,
    gramsAdditive: oilBlend.gramsCannabisOil,
    gramsMctCarrier: oilBlend.gramsMctCarrier,
    gramsTotalInfusedOilBlend: oilBlend.gramsTotalInfusedOilBlend,
    mctCarrierPercent: mctPct,
    finalDosingBatchGrams,
    totalActiveMgNeeded,
    gramsCitricSolution,
    gramsTotalCheck,
    nominalPieces,
    piecesAfterLineWaste,
    additiveMassFractionPct: g(additiveMassFraction * 100),
    warnings,
  };
}

export function planPectinSingleAdditiveBatch(raw: PectinSingleAdditiveInput): PectinSingleAdditivePlan {
  if (usesMctBaseMode(raw)) {
    return planPectinSingleAdditiveBatchMctBase(raw);
  }

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
  const totalActiveMgNeeded = g(nominalPieces * raw.targetMgPerPiece);

  return {
    additiveMassFraction,
    citricMassFraction,
    partAPectinMassFraction,
    gramsPartAPectin,
    gramsAdditive,
    gramsMctCarrier: 0,
    gramsTotalInfusedOilBlend: gramsAdditive,
    finalDosingBatchGrams: batchSizeGrams,
    totalActiveMgNeeded,
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
  mctCarrierPercent?: number;
  basePartAGrams?: number;
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
  finalDosingBatchGrams: number;
  totalActiveMgNeeded: number;
  nominalPieces: number;
  piecesAfterLineWaste: number;
  totalAdditiveMassFractionPct: number;
  warnings: string[];
};

function planPectinMultiAdditiveBatchMctBase(raw: PectinMultiAdditiveInput): PectinMultiAdditivePlan {
  const basePartAGrams = g(raw.basePartAGrams!);
  const mctPct = g(raw.mctCarrierPercent!);
  const citricMassFraction = g(raw.citricMassFraction ?? 0.014);
  const lineWasteFraction = raw.lineWasteFraction ?? 0.05;
  const extras = (raw.extraMassFractions ?? []).map((x) => g(x));
  const extraSum = g(extras.reduce((s, x) => s + x, 0));

  if (!raw.additives.length) throw new RangeError("At least one additive line is required");
  if (raw.gramsPerPiece <= 0) throw new RangeError("gramsPerPiece must be positive");
  if (lineWasteFraction < 0 || lineWasteFraction >= 1) throw new RangeError("lineWasteFraction must be in [0, 1)");

  const gramsMctCarrier = g(basePartAGrams * (mctPct / 100));
  const finalDosingBatchGrams = g(basePartAGrams + gramsMctCarrier);
  const nominalPieces = g(finalDosingBatchGrams / raw.gramsPerPiece);
  const piecesAfterLineWaste = g(nominalPieces * (1 - lineWasteFraction));

  const gramsAdditives = raw.additives.map((line) => {
    if (line.potencyFraction <= 0) throw new RangeError("potencyFraction must be positive");
    const mg = g(nominalPieces * line.goalMgPerPiece);
    return g(mg / (line.potencyFraction * 1000));
  });
  const gramsCannabisOilCombined = g(gramsAdditives.reduce((a, b) => a + b, 0));
  const totalActiveMgNeeded = g(
    raw.additives.reduce((s, line) => s + nominalPieces * line.goalMgPerPiece, 0),
  );

  const oilBlend = computeMctFromPartABase(basePartAGrams, mctPct, gramsCannabisOilCombined);

  const gramsExtras = extras.map((f) => g(f * finalDosingBatchGrams));
  const nonCitricMass = g(
    basePartAGrams + gramsMctCarrier + gramsCannabisOilCombined + gramsExtras.reduce((a, b) => a + b, 0),
  );
  const gramsTotalFormula = g(nonCitricMass / (1 - citricMassFraction));
  const gramsCitric = g(gramsTotalFormula * citricMassFraction);
  const gramsPartA = basePartAGrams;
  const total = g(gramsPartA + gramsMctCarrier + gramsCannabisOilCombined + gramsExtras.reduce((a, b) => a + b, 0) + gramsCitric);

  const additiveMassFractions = gramsAdditives.map((oilG) =>
    finalDosingBatchGrams > 0 ? g(oilG / finalDosingBatchGrams) : 0,
  );
  const additivesSum = g(additiveMassFractions.reduce((s, x) => s + x, 0));
  const partAPectinMassFraction = gramsTotalFormula > 0 ? g(gramsPartA / gramsTotalFormula) : 0;

  const warnings: string[] = [];
  if (additivesSum > 0.04) {
    warnings.push(
      "Combined cannabis oil exceeds 4% of the dosing batch (base + MCT) — Melt-to-Make recommends staying under 4% for most SKUs.",
    );
  }

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
    mctCarrierPercent: mctPct,
    finalDosingBatchGrams,
    totalActiveMgNeeded,
    nominalPieces,
    piecesAfterLineWaste,
    totalAdditiveMassFractionPct: g(additivesSum * 100),
    warnings,
  };
}

export function planPectinMultiAdditiveBatch(raw: PectinMultiAdditiveInput): PectinMultiAdditivePlan {
  if (usesMctBaseMode(raw)) {
    return planPectinMultiAdditiveBatchMctBase(raw);
  }

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
  const totalActiveMgNeeded = g(
    raw.additives.reduce((s, line) => s + nominalPieces * line.goalMgPerPiece, 0),
  );

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
    gramsMctCarrier: 0,
    gramsTotalInfusedOilBlend: g(gramsAdditives.reduce((a, b) => a + b, 0)),
    finalDosingBatchGrams: batchSizeGrams,
    totalActiveMgNeeded,
    nominalPieces,
    piecesAfterLineWaste,
    totalAdditiveMassFractionPct: totalAdditivePct,
    warnings,
  };
}
