import type {
  PectinMultiAdditivePlan,
  PectinSingleAdditiveInput,
  PectinSingleAdditivePlan,
} from "@/lib/ediblesPectinFormula";
import { postEdibleIngredient } from "./ediblesApi";

export const PECTIN_FORMULA_VERSION = "pectin-melt-v1" as const;

const NOTES_MAX = 8000;

export type PectinMeltFormulaSnapshot = {
  formulaVersion: typeof PECTIN_FORMULA_VERSION;
  timestamp: string;
  kind: "single" | "multi";
  batchSizeGrams: number;
  /** Present for single-additive runs; for multi, see `additivesLines`. */
  potencyFraction?: number;
  /** Single: same as calculator target. Multi: sum of per-piece additive goals (mg). */
  targetMgPerPiece: number;
  gramsPerPiece: number;
  citricMassFraction: number;
  lineWasteFraction: number;
  gramsPartA: number;
  /** Cannabis oil required for target dose (calculated). */
  gramsAdditive: number;
  mctCarrierPercent?: number;
  gramsMctCarrier?: number;
  gramsTotalInfusedOilBlend?: number;
  finalDosingBatchGrams?: number;
  totalActiveMgNeeded?: number;
  /** Oil grams submitted on the edible batch (infusion allocation). */
  oilInputGrams: number;
  gramsCitric: number;
  piecesBeforeWaste: number;
  piecesAfterLineWaste: number;
  targetPieces: number;
  /** Full calculator output for audit. */
  calculatorPlan: PectinSingleAdditivePlan | PectinMultiAdditivePlan;
  additivesLines?: Array<{
    index: number;
    goalMgPerPiece: number;
    potencyFraction: number;
    massFraction: number;
    grams: number;
  }>;
  extraMassFractions?: number[];
  gramsExtras?: number[];
};

function trimUserNotes(s: string) {
  return s.replace(/\r\n/g, "\n").trim();
}

/**
 * Human-readable block + single-line JSON for `EdibleBatch.notes`.
 * User notes are kept first when non-empty.
 */
export function mergeUserNotesAndPectinPlan(userNotes: string, snapshot: PectinMeltFormulaSnapshot): string {
  const json = JSON.stringify(snapshot);
  const readable = formatPectinReadableHeader(snapshot);
  const block = `${readable}\n\nJSON:\n${json}`;
  const u = trimUserNotes(userNotes);
  const combined = u ? `${u}\n\n---\n\n${block}` : block;
  if (combined.length > NOTES_MAX) {
    throw new Error(
      `Combined production notes and pectin plan exceed ${NOTES_MAX} characters (${combined.length}). Shorten your notes and try again.`,
    );
  }
  return combined;
}

export function formatPectinReadableHeader(s: PectinMeltFormulaSnapshot): string {
  const lines = [
    "Pectin Melt Formula Plan",
    `Formula Version: ${s.formulaVersion}`,
    `Target: ${s.targetMgPerPiece} mg per piece`,
    `Piece Weight: ${s.gramsPerPiece} g`,
    `Expected Yield After Waste: ${s.piecesAfterLineWaste} pieces`,
    `Cannabis oil required: ${s.gramsAdditive.toFixed(2)} g`,
  ];
  if (s.gramsMctCarrier != null && s.gramsMctCarrier > 0) {
    lines.push(`Base / Part A: ${s.gramsPartA.toFixed(2)} g`);
    lines.push(
      `MCT carrier (${s.mctCarrierPercent ?? "?"}% of base): ${s.gramsMctCarrier.toFixed(2)} g`,
    );
    if (s.finalDosingBatchGrams != null) {
      lines.push(`Final formula mass: ${s.finalDosingBatchGrams.toFixed(2)} g`);
    }
    if (s.totalActiveMgNeeded != null) {
      lines.push(`Total active mg needed: ${s.totalActiveMgNeeded.toFixed(2)} mg`);
    }
    lines.push(`Total infused oil blend to add: ${(s.gramsTotalInfusedOilBlend ?? s.gramsAdditive).toFixed(2)} g`);
  }
  return lines.join("\n");
}

export function buildSnapshotFromSingle(args: {
  input: PectinSingleAdditiveInput;
  plan: PectinSingleAdditivePlan;
  oilInputGrams: number;
  targetPieces: number;
  lineWasteFraction: number;
}): PectinMeltFormulaSnapshot {
  const { input, plan, oilInputGrams, targetPieces, lineWasteFraction } = args;
  return {
    formulaVersion: PECTIN_FORMULA_VERSION,
    timestamp: new Date().toISOString(),
    kind: "single",
    batchSizeGrams: input.batchSizeGrams,
    potencyFraction: input.potencyFraction,
    targetMgPerPiece: input.targetMgPerPiece,
    gramsPerPiece: input.gramsPerPiece,
    citricMassFraction: plan.citricMassFraction,
    lineWasteFraction,
    gramsPartA: plan.gramsPartAPectin,
    gramsAdditive: plan.gramsAdditive,
    mctCarrierPercent: plan.mctCarrierPercent,
    gramsMctCarrier: plan.gramsMctCarrier > 0 ? plan.gramsMctCarrier : undefined,
    gramsTotalInfusedOilBlend:
      plan.gramsMctCarrier > 0 ? plan.gramsTotalInfusedOilBlend : undefined,
    finalDosingBatchGrams: plan.gramsMctCarrier > 0 ? plan.finalDosingBatchGrams : undefined,
    totalActiveMgNeeded: plan.gramsMctCarrier > 0 ? plan.totalActiveMgNeeded : undefined,
    oilInputGrams,
    gramsCitric: plan.gramsCitricSolution,
    piecesBeforeWaste: plan.nominalPieces,
    piecesAfterLineWaste: plan.piecesAfterLineWaste,
    targetPieces,
    calculatorPlan: plan,
  };
}

export function buildSnapshotFromMulti(args: {
  batchSizeGrams: number;
  gramsPerPiece: number;
  citricMassFraction: number;
  lineWasteFraction: number;
  plan: PectinMultiAdditivePlan;
  inputAdditives: { goalMgPerPiece: number; potencyFraction: number }[];
  extraMassFractions: number[];
  oilInputGrams: number;
  targetPieces: number;
}): PectinMeltFormulaSnapshot {
  const { plan, inputAdditives, extraMassFractions, oilInputGrams, targetPieces, lineWasteFraction } = args;
  const additivesLines = inputAdditives.map((row, i) => ({
    index: i + 1,
    goalMgPerPiece: row.goalMgPerPiece,
    potencyFraction: row.potencyFraction,
    massFraction: plan.additiveMassFractions[i] ?? 0,
    grams: plan.gramsByLine.additives[i] ?? 0,
  }));
  const totalGoalMg = inputAdditives.reduce((s, r) => s + r.goalMgPerPiece, 0);
  const gramsAdditive = plan.gramsByLine.additives.reduce((s, x) => s + x, 0);

  return {
    formulaVersion: PECTIN_FORMULA_VERSION,
    timestamp: new Date().toISOString(),
    kind: "multi",
    batchSizeGrams: args.batchSizeGrams,
    targetMgPerPiece: totalGoalMg,
    gramsPerPiece: args.gramsPerPiece,
    citricMassFraction: plan.citricMassFraction,
    lineWasteFraction,
    gramsPartA: plan.gramsByLine.partAPectin,
    gramsAdditive,
    mctCarrierPercent: plan.mctCarrierPercent,
    gramsMctCarrier: plan.gramsMctCarrier > 0 ? plan.gramsMctCarrier : undefined,
    gramsTotalInfusedOilBlend:
      plan.gramsMctCarrier > 0 ? plan.gramsTotalInfusedOilBlend : undefined,
    finalDosingBatchGrams: plan.gramsMctCarrier > 0 ? plan.finalDosingBatchGrams : undefined,
    totalActiveMgNeeded: plan.gramsMctCarrier > 0 ? plan.totalActiveMgNeeded : undefined,
    oilInputGrams,
    gramsCitric: plan.gramsByLine.citric,
    piecesBeforeWaste: plan.nominalPieces,
    piecesAfterLineWaste: plan.piecesAfterLineWaste,
    targetPieces,
    calculatorPlan: plan,
    additivesLines,
    extraMassFractions: extraMassFractions.length ? extraMassFractions : undefined,
    gramsExtras: plan.gramsByLine.extras.some((x) => x > 0) ? plan.gramsByLine.extras : undefined,
  };
}

/**
 * Persists planned kitchen masses on the batch after creation (Part A, oil allocation, citric; multi adds extra rows).
 */
export async function postPectinKitchenIngredients(batchId: string, snapshot: PectinMeltFormulaSnapshot): Promise<void> {
  const posts: Promise<unknown>[] = [];
  const add = (ingredientName: string, grams: number) => {
    if (!Number.isFinite(grams) || grams <= 0) return;
    posts.push(postEdibleIngredient(batchId, { ingredientName, weight: grams, unit: "g" }));
  };
  add("Melt-to-Make™ Pectin Base (Part A)", snapshot.gramsPartA);
  const mct = snapshot.gramsMctCarrier ?? 0;
  if (mct > 0 && snapshot.gramsTotalInfusedOilBlend != null) {
    add("Cannabis oil", snapshot.gramsAdditive);
    add("MCT carrier oil", mct);
    add("Total infused oil blend", snapshot.gramsTotalInfusedOilBlend);
  } else {
    add("Cannabis oil / additive (batch allocation)", snapshot.oilInputGrams);
  }
  add("Citric Acid Solution (Part B)", snapshot.gramsCitric);
  if (snapshot.kind === "multi" && snapshot.gramsExtras?.length) {
    snapshot.gramsExtras.forEach((grams, i) => {
      add(`Pectin formula extra mass #${i + 1}`, grams);
    });
  }
  await Promise.all(posts);
}
