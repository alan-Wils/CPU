/** Shared LeafLink payment amount checks for check capture and cash log. */

export const LEAF_LINK_PAYMENT_AMOUNT_TOLERANCE = 0.01;

export function sameLeafLinkMoney(a: number, b: number): boolean {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= LEAF_LINK_PAYMENT_AMOUNT_TOLERANCE;
}

export function leafLinkOrderOwedAmount(order: {
  outstandingBalance?: number | null;
  total?: number | null;
}): number {
  const outstanding = order.outstandingBalance;
  if (typeof outstanding === "number" && Number.isFinite(outstanding)) return outstanding;
  const total = order.total;
  if (typeof total === "number" && Number.isFinite(total)) return total;
  return NaN;
}

export function leafLinkPaymentMatchesInvoice(
  payAmt: number,
  expectedBalance: number,
  orderTotal: number,
): boolean {
  return sameLeafLinkMoney(expectedBalance, payAmt) || sameLeafLinkMoney(orderTotal, payAmt);
}

export function buildLeafLinkCpuPaymentNote(
  baseNote: string,
  mismatch: boolean,
  overrideNote?: string | null,
): string {
  const trimmed = String(overrideNote || "").trim();
  if (!mismatch) return baseNote;
  if (!trimmed) return `${baseNote} — amount differs from invoice balance`;
  return `${baseNote} — amount override: ${trimmed}`;
}
