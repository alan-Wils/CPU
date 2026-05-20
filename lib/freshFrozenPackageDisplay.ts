/** Fresh Frozen package math + Extraction display helpers (lbs / grams / bundles). */

export const GRAMS_PER_LB = 453.592;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** True when tag is missing or an auto-generated split placeholder (e.g. BUNDLE, BUNDLE-3). */
export function isPlaceholderFreshFrozenMetrcTag(tag: unknown): boolean {
  const t = String(tag ?? "").trim();
  if (!t) return true;
  return /^BUNDLE(?:-\d+)?$/i.test(t);
}

/** From company config `cultivation.freshFrozenGramsPerBundle`; 0 = manual bundles only. */
export function parseFreshFrozenGramsPerBundle(raw: unknown): number {
  const n = Math.floor(num(raw));
  if (n <= 0) return 0;
  return Math.min(n, 1_000_000);
}

/** Whole bundles that fit in total harvest grams (floor). */
export function bundlesFromTotalGrams(totalGrams: number, gramsPerBundle: number): number {
  const g = num(totalGrams);
  const per = num(gramsPerBundle);
  if (g <= 0 || per <= 0) return 0;
  return Math.floor(g / per);
}

/** Bundle slots needed for total grams, counting a partial final bundle (ceil). */
export function bundleSlotCountFromTotalGrams(totalGrams: number, gramsPerBundle: number): number {
  const g = num(totalGrams);
  const per = num(gramsPerBundle);
  if (g <= 0 || per <= 0) return 0;
  return Math.ceil(g / per);
}

export function sourceRowTotalGrams(src: unknown): number {
  if (!src || typeof src !== "object") return 0;
  const s = src as Record<string, unknown>;
  const g = num(s.grams);
  if (g > 0) return g;
  const w = num(s.weightLbs);
  if (w > 0) return +(w * GRAMS_PER_LB).toFixed(4);
  return 0;
}

export function sourceRowTotalLbs(src: unknown): number {
  if (!src || typeof src !== "object") return 0;
  const s = src as Record<string, unknown>;
  const w = num(s.weightLbs);
  if (w > 0) return w;
  const g = num(s.grams);
  if (g > 0) return +(g / GRAMS_PER_LB).toFixed(6);
  return 0;
}

export function sourceRowBundles(src: unknown): number {
  if (!src || typeof src !== "object") return 0;
  return Math.max(0, Math.floor(num((src as Record<string, unknown>).bundles)));
}

export type FreshFrozenPackageDisplay = {
  totalLbsLabel: string;
  totalGramsLabel: string;
  bundlesLabel: string;
  /** Single line for cards / dropdowns */
  packageLine: string;
};

/** Labels for total package size on a source row (Fresh Frozen). */
export function freshFrozenPackageDisplay(src: unknown): FreshFrozenPackageDisplay {
  const g = sourceRowTotalGrams(src);
  const lbs = g > 0 ? g / GRAMS_PER_LB : sourceRowTotalLbs(src);
  const gramsInt = g > 0 ? Math.round(g) : Math.round(lbs * GRAMS_PER_LB);
  const b = sourceRowBundles(src);

  const totalLbsLabel = lbs > 0 ? `${+lbs.toFixed(4)} lbs` : "— lbs";
  const totalGramsLabel = gramsInt > 0 ? `${gramsInt} g` : "— g";
  const bundlesLabel = b > 0 ? `${b}` : "—";

  const packageLine = `Package: ${totalLbsLabel} · ${totalGramsLabel} · ${bundlesLabel} bundles`;

  return { totalLbsLabel, totalGramsLabel, bundlesLabel, packageLine };
}

export function freshFrozenAvailableLine(availableLbs: number): string {
  const a = num(availableLbs);
  if (a <= 0) return "Available: 0 lbs";
  const ag = Math.round(a * GRAMS_PER_LB);
  return `Available: ${+a.toFixed(4)} lbs (~${ag} g)`;
}
