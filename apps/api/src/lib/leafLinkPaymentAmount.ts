/** Shared LeafLink payment amount checks for check capture and cash log. */

import { AppError } from "../errors/AppError.js";

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

/** Cap a payment at the invoice balance — never overpay. */
export function capLeafLinkPaymentToOwed(paymentAmount: number, owedAmount: number): number {
  const pay = Number(paymentAmount);
  const owed = Number(owedAmount);
  if (!Number.isFinite(pay) || pay <= 0) return NaN;
  if (!Number.isFinite(owed) || owed <= 0) return NaN;
  return Math.round(Math.min(pay, owed) * 100) / 100;
}

/**
 * Hard block: payment amount must not exceed the invoice balance owed.
 * Override notes cannot bypass this.
 */
export function assertLeafLinkPaymentDoesNotOverpay(
  paymentAmount: number,
  owedBalance: number,
  code = "LEAFLINK_OVERPAY_BLOCKED",
): void {
  const pay = Number(paymentAmount);
  const owed = Number(owedBalance);
  if (!Number.isFinite(pay) || pay <= 0) {
    throw new AppError("Payment amount is invalid.", 400, "LEAFLINK_PAYMENT_AMOUNT_INVALID");
  }
  if (!Number.isFinite(owed) || owed < 0) {
    throw new AppError("Invoice balance owed is invalid.", 400, "LEAFLINK_BALANCE_INVALID");
  }
  if (pay > owed + LEAF_LINK_PAYMENT_AMOUNT_TOLERANCE) {
    throw new AppError(
      `Payment amount cannot exceed the invoice balance owed ($${owed.toFixed(2)}). Overpaying invoices is not allowed.`,
      400,
      code,
    );
  }
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
