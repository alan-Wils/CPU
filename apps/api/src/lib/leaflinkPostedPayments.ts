/** Rows persisted on CheckCapture / CashLogEntry JSON column `leaflinkPostedPayments`. */
export type LeafLinkPostedPaymentRow = {
  orderNumber: string;
  paymentId: string;
  amount: number;
  postedAt: string;
};

export function parsePostedPaymentsJson(raw: unknown): LeafLinkPostedPaymentRow[] {
  if (!Array.isArray(raw))
    return [];
  const out: LeafLinkPostedPaymentRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object")
      continue;
    const rec = item as Record<string, unknown>;
    const orderNumber = String(rec.orderNumber ?? "").trim();
    const paymentId = String(rec.paymentId ?? "").trim();
    const amount = typeof rec.amount === "number" && Number.isFinite(rec.amount) ? rec.amount : Number(rec.amount);
    const postedAt = String(rec.postedAt ?? "").trim();
    if (!orderNumber || !paymentId || !Number.isFinite(amount))
      continue;
    out.push({
      orderNumber,
      paymentId,
      amount,
      postedAt: postedAt || new Date().toISOString(),
    });
  }
  return out;
}

/** Merge JSON array with legacy single-payment columns on CheckCapture. */
export function mergePostedPaymentsFromCheckCapture(check: {
  leaflinkPostedPayments?: unknown;
  leaflinkPaymentId?: string | null;
  leaflinkOrderNumber?: string | null;
  amount?: number | null;
}): LeafLinkPostedPaymentRow[] {
  const fromJson = parsePostedPaymentsJson(check.leaflinkPostedPayments);
  if (fromJson.length)
    return fromJson;
  const pid = String(check.leaflinkPaymentId ?? "").trim();
  const onum = String(check.leaflinkOrderNumber ?? "").trim();
  if (pid && onum) {
    const amt = typeof check.amount === "number" && Number.isFinite(check.amount) ? check.amount : 0;
    return [{ orderNumber: onum, paymentId: pid, amount: amt, postedAt: new Date().toISOString() }];
  }
  return [];
}

export function hasPostedOrderNumber(
  posted: LeafLinkPostedPaymentRow[],
  orderNumber: string,
): boolean {
  const want = String(orderNumber ?? "").trim().toLowerCase();
  if (!want) return false;
  const wantKey = want.replace(/[^a-z0-9]/g, "");
  return posted.some((p) => {
    const have = String(p.orderNumber ?? "").trim().toLowerCase();
    if (!have) return false;
    if (have === want) return true;
    const haveKey = have.replace(/[^a-z0-9]/g, "");
    return Boolean(wantKey && haveKey && wantKey === haveKey);
  });
}
