/** Shared weight display and grams-first input helpers (storage often remains in lbs). */

export { GRAMS_PER_LB } from "@/lib/freshFrozenPackageDisplay";

import { GRAMS_PER_LB } from "@/lib/freshFrozenPackageDisplay";

import { EM_DASH, MIDDLE_DOT } from "@/lib/textSymbols";

export { EM_DASH, MIDDLE_DOT } from "@/lib/textSymbols";

/** Placeholder for missing numeric weight. */
export const EMPTY_WEIGHT_DASH = EM_DASH;

export function num(value: unknown): number {
  const n = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

export function lbsToGrams(lbs: number): number {
  const w = num(lbs);
  if (w <= 0) return 0;
  return Math.round(w * GRAMS_PER_LB * 100) / 100;
}

export function gramsToLbs(grams: number): number {
  const g = num(grams);
  if (g <= 0) return 0;
  return +(g / GRAMS_PER_LB).toFixed(4);
}

/** User-entered grams \u2192 lbs for legacy store / API fields. */
export function gramsInputToLbs(raw: string | number): number {
  return gramsToLbs(num(raw));
}

/** Populate a grams input from stored lbs. */
export function lbsToGramsInputString(lbs: number): string {
  const g = lbsToGrams(lbs);
  return g > 0 ? String(Math.round(g)) : "";
}

export function formatOptionalGrams(grams: number): string {
  const g = num(grams);
  return g > 0 ? `${Math.round(g).toLocaleString()} g` : EMPTY_WEIGHT_DASH;
}

export function formatGramsAndLbs(grams: number): string {
  const g = num(grams);
  if (g <= 0) return EMPTY_WEIGHT_DASH;
  const lbs = gramsToLbs(g);
  return `${Math.round(g).toLocaleString()} g ${MIDDLE_DOT} ${lbs.toFixed(2)} lbs`;
}
