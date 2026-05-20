export type FreshFrozenBundleDraft = {
  id: string;
  metrcTag: string;
  grams: string;
};

export function newFreshFrozenBundleRow(): FreshFrozenBundleDraft {
  return {
    id: `ffb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    metrcTag: "",
    grams: "",
  };
}

export function parseFreshFrozenBundleGrams(raw: string): number {
  const n = Number(String(raw ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function sumFreshFrozenBundleGrams(rows: FreshFrozenBundleDraft[]): number {
  return rows.reduce((acc, row) => acc + parseFreshFrozenBundleGrams(row.grams), 0);
}

/** Split total grams across N new rows (tags still entered manually). */
export type HarvestSheetWeightRow = {
  tag: string;
  weightValue: string;
  unitGuess?: string;
};

export function gramsFromHarvestSheetWeightRow(row: HarvestSheetWeightRow): number {
  const w = Number(String(row.weightValue ?? "").replace(/,/g, "").trim());
  if (!(w > 0)) return 0;
  const u = String(row.unitGuess || "").toLowerCase();
  if (u === "lbs" || u === "lb") return Math.round(w * 453.592 * 100) / 100;
  if (u === "oz") return Math.round(w * 28.3495 * 100) / 100;
  return Math.round(w * 100) / 100;
}

/** One bundle row per harvest-sheet line that has a tag and weight. */
export function freshFrozenBundleRowsFromHarvestSheet(
  rows: HarvestSheetWeightRow[],
): FreshFrozenBundleDraft[] {
  const out: FreshFrozenBundleDraft[] = [];
  for (const row of rows) {
    const tag = String(row.tag || "").trim();
    const grams = gramsFromHarvestSheetWeightRow(row);
    if (!tag || grams <= 0) continue;
    out.push({
      ...newFreshFrozenBundleRow(),
      metrcTag: tag,
      grams: String(grams),
    });
  }
  return out.length > 0 ? out : [newFreshFrozenBundleRow()];
}

/** Split total grams into full bundles of `gramsPerBundle` plus one partial remainder row. */
export function splitGramsByConfiguredBundleSize(
  totalGrams: number,
  gramsPerBundle: number,
  existingRows: FreshFrozenBundleDraft[] = [],
): FreshFrozenBundleDraft[] {
  const total = Math.max(0, totalGrams);
  const per = Math.floor(gramsPerBundle);
  if (total <= 0 || per <= 0) {
    return existingRows.length > 0 ? existingRows : [newFreshFrozenBundleRow()];
  }

  const count = Math.ceil(total / per);
  const rows: FreshFrozenBundleDraft[] = [];
  let remaining = total;

  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1;
    const bundleGrams = isLast ? +remaining.toFixed(2) : per;
    remaining = +(remaining - bundleGrams).toFixed(2);
    const existing = existingRows[i];
    rows.push({
      id: existing?.id ?? newFreshFrozenBundleRow().id,
      metrcTag: existing?.metrcTag ?? "",
      grams: bundleGrams > 0 ? String(bundleGrams) : "",
    });
  }

  return rows;
}

/** Increment trailing digits on a METRC-style tag (e.g. 1111 → 1112). */
export function incrementMetrcPackageTag(baseTag: string, step: number): string {
  const tag = String(baseTag ?? "").trim();
  if (!tag || step < 0) return tag;
  const match = tag.match(/^(.*?)(\d+)$/);
  if (!match) return tag;
  const prefix = match[1];
  const digits = match[2];
  const width = digits.length;
  try {
    const next = BigInt(digits) + BigInt(step);
    if (next < 0n) return tag;
    const nextStr = next.toString();
    const padded = nextStr.length <= width ? nextStr.padStart(width, "0") : nextStr;
    return `${prefix}${padded}`;
  } catch {
    return tag;
  }
}

/** Fill bundle #2+ from bundle #1 tag in ascending order (1111, 1112, 1113, …). */
export function fillAscendingMetrcTagsFromFirstBundle(rows: FreshFrozenBundleDraft[]): {
  rows: FreshFrozenBundleDraft[];
  ok: boolean;
  message?: string;
} {
  if (rows.length === 0) {
    return { rows, ok: false, message: "No bundles to fill." };
  }
  const seed = String(rows[0]?.metrcTag ?? "").trim();
  if (!seed) {
    return { rows, ok: false, message: "Enter a METRC tag on bundle #1 first." };
  }
  if (rows.length > 1 && incrementMetrcPackageTag(seed, 1) === seed) {
    return {
      rows,
      ok: false,
      message: "Bundle #1 tag must end in numbers (e.g. 1111) to auto-fill the rest.",
    };
  }
  return {
    rows: rows.map((row, idx) => ({
      ...row,
      metrcTag: idx === 0 ? seed : incrementMetrcPackageTag(seed, idx),
    })),
    ok: true,
  };
}

export function splitGramsAcrossFreshFrozenBundles(
  totalGrams: number,
  count: number,
): FreshFrozenBundleDraft[] {
  const n = Math.max(1, Math.floor(count));
  const total = Math.max(0, totalGrams);
  const base = Math.floor((total / n) * 100) / 100;
  const rows: FreshFrozenBundleDraft[] = [];
  let allocated = 0;
  for (let i = 0; i < n; i++) {
    const isLast = i === n - 1;
    const g = isLast ? +(total - allocated).toFixed(2) : base;
    allocated += g;
    rows.push({
      ...newFreshFrozenBundleRow(),
      grams: g > 0 ? String(g) : "",
    });
  }
  return rows;
}
