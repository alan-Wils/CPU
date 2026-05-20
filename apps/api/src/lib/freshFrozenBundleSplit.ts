/**
 * Fresh Frozen bundle gram allocation (matches lib/freshFrozenBundleRows.ts).
 * First N−1 bundles use configured grams; last bundle gets remainder.
 */

export function parseFreshFrozenGramsPerBundle(raw: unknown): number {
    const n = Math.floor(Number(raw) || 0);
    if (n <= 0) return 0;
    return Math.min(n, 1_000_000);
}

export function splitGramsAcrossFixedBundleCount(
    totalGrams: number,
    gramsPerBundle: number,
    bundleCount: number,
): number[] {
    const total = Math.max(0, Math.round(totalGrams * 100) / 100);
    const per = Math.floor(gramsPerBundle);
    const n = Math.max(1, Math.floor(bundleCount));
    if (total <= 0 || per <= 0 || n <= 0) return [];

    const amounts: number[] = [];
    let remaining = total;
    for (let i = 0; i < n; i++) {
        const isLast = i === n - 1;
        const bundleGrams = isLast ? +remaining.toFixed(2) : per;
        amounts.push(bundleGrams);
        remaining = +(remaining - bundleGrams).toFixed(2);
    }
    return amounts;
}

/** Bundle slots for total grams (full bundles + partial last), same as harvest UI. */
export function bundleSlotCountFromTotalGrams(totalGrams: number, gramsPerBundle: number): number {
    const g = Math.max(0, Number(totalGrams) || 0);
    const per = Math.floor(Number(gramsPerBundle) || 0);
    if (g <= 0 || per <= 0) return 0;
    return Math.ceil(g / per);
}

/** Even split fallback when company config has no grams-per-bundle. */
export function splitGramsEvenly(totalGrams: number, count: number): number[] {
    const total = Math.max(0, Math.round(totalGrams * 100) / 100);
    const n = Math.max(1, Math.floor(count));
    const base = Math.floor((total / n) * 100) / 100;
    const amounts = Array.from({ length: n }, () => base);
    let remainder = Math.round((total - base * n) * 100) / 100;
    let idx = n - 1;
    while (remainder > 0.009 && idx >= 0) {
        const add = Math.min(0.01, remainder);
        amounts[idx] = Math.round((amounts[idx] + add) * 100) / 100;
        remainder = Math.round((remainder - add) * 100) / 100;
        idx--;
    }
    return amounts;
}
