/**
 * Shared LeafLink invoice / order matching.
 * Keep in sync with `packages/shared/src/leafLinkInvoiceMatch.ts`
 * (Railway builds the API in isolation without `@cpu/shared`).
 *
 * A typed token matches a LeafLink order only when:
 * - the normalized values are an exact order code (e.g. `d83a10061`), or
 * - a digit-only invoice number equals the order code's complete trailing
 *   numeric portion (`10061` ↔ `d83a10061`, `9963` ↔ `d83a9963`).
 *
 * Do not slice a fixed last-4/last-5 of every digit in the string: `d83a9963`
 * contains `a9963`, and last-4 of all digits in `d83a10061` is `0061`.
 */

import { AppError } from "../errors/AppError.js";

export type LeafLinkInvoiceTokenMatchKind =
  | "invoice_exact"
  | "invoice_last4"
  | "invoice_partial";

/** Kinds that may be posted (exact code or complete trailing invoice digits). */
export const LEAF_LINK_INVOICE_POST_MATCH_KINDS: ReadonlySet<LeafLinkInvoiceTokenMatchKind> =
  new Set(["invoice_exact", "invoice_last4"]);

/** Kinds offered as "possible" matches when the invoice field is filled. */
export const LEAF_LINK_INVOICE_POSSIBLE_MATCH_KINDS: ReadonlySet<LeafLinkInvoiceTokenMatchKind> =
  new Set(["invoice_partial", "invoice_last4"]);

/** User-entered invoice field may list several refs separated by comma, semicolon, whitespace, or newline. */
export function splitInvoiceNumberTokens(raw: string | undefined): string[] {
  if (!raw) return [];
  return String(raw)
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function invoiceDigitsOnly(s: string): string {
  return String(s || "").replace(/\D/g, "");
}

/** Normalize invoice / order refs for exact compare (e.g. d83a10061). */
export function normalizeInvoiceOrderKey(raw: string | undefined | null): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Complete trailing run of digits on a human LeafLink order code.
 * `d83a10061` → `10061`; `d83a9963` → `9963`. Prefix letters are ignored.
 */
export function trailingNumericInvoicePortion(orderCode: string | undefined | null): string {
  const key = normalizeInvoiceOrderKey(orderCode);
  if (!key) return "";
  const m = /(\d+)$/.exec(key);
  return m ? m[1] : "";
}

/**
 * True when the typed token is a short stub (digit invoice # or short prefix).
 * Full invoice codes like `d83a10061` must match the whole order number.
 */
export function isShortInvoiceStubToken(tok: string): boolean {
  const key = normalizeInvoiceOrderKey(tok);
  if (!key) return false;
  if (/^\d+$/.test(key)) return true;
  return key.length <= 4;
}

export function isNumericInvoiceStubToken(tok: string): boolean {
  const key = normalizeInvoiceOrderKey(tok);
  return key.length > 0 && /^\d+$/.test(key);
}

/**
 * LeafLink UUID / opaque ids (after normalize). Never use these for short-stub
 * substring matching — digits like `9632` appear inside random UUIDs.
 */
export function isOpaqueLeafLinkIdentityKey(normalizedKey: string): boolean {
  if (!normalizedKey) return true;
  if (/^[a-f0-9]{32}$/i.test(normalizedKey)) return true;
  if (normalizedKey.length >= 24 && /^[a-f0-9]+$/i.test(normalizedKey)) return true;
  return false;
}

export function invoiceMatchKindAllowsPost(
  kind: LeafLinkInvoiceTokenMatchKind | null,
): boolean {
  return kind != null && LEAF_LINK_INVOICE_POST_MATCH_KINDS.has(kind);
}

export function matchedByIncludesPossibleInvoiceMatch(matchedBy: string[]): boolean {
  return matchedBy.some((k) =>
    LEAF_LINK_INVOICE_POSSIBLE_MATCH_KINDS.has(k as LeafLinkInvoiceTokenMatchKind),
  );
}

/**
 * Classify how a typed invoice token relates to a LeafLink order.
 * Full codes like `d83a10061` only return exact (never trailing-digit).
 * Digit stubs match the complete trailing numeric portion of human order
 * numbers — never UUID ids, never an arbitrary suffix (`0061` ↛ `d83a10061`).
 */
export function classifyInvoiceTokenMatch(
  token: string,
  orderIdentityKeys: string[],
  orderNumberForTail: string,
): LeafLinkInvoiceTokenMatchKind | null {
  const tok = String(token || "").trim();
  if (!tok) return null;
  const normTok = normalizeInvoiceOrderKey(tok);
  if (!normTok) return null;
  const allKeys = orderIdentityKeys.map((k) => normalizeInvoiceOrderKey(k)).filter(Boolean);
  if (allKeys.some((k) => k === normTok)) return "invoice_exact";

  const orderNumberKeys = [
    ...allKeys.filter((k) => !isOpaqueLeafLinkIdentityKey(k)),
    normalizeInvoiceOrderKey(orderNumberForTail),
  ].filter((k) => k && !isOpaqueLeafLinkIdentityKey(k));

  if (isNumericInvoiceStubToken(tok)) {
    const trailingPortions = new Set(
      [
        trailingNumericInvoicePortion(orderNumberForTail),
        ...orderNumberKeys.map((k) => trailingNumericInvoicePortion(k)),
      ].filter(Boolean),
    );
    if (trailingPortions.has(normTok)) return "invoice_last4";
    return null;
  }

  if (isShortInvoiceStubToken(tok)) {
    if (orderNumberKeys.some((k) => k.includes(normTok))) {
      return "invoice_partial";
    }
  } else if (normTok.length <= 5) {
    if (orderNumberKeys.some((k) => k.includes(normTok))) {
      return "invoice_partial";
    }
  }
  return null;
}

/**
 * When an invoice number is present on a check/cash row, the selected LeafLink order must
 * match it (full code exact, or complete trailing numeric invoice portion). Blocks
 * payee/amount-only wrong posts like applying invoice 9849 onto order d83a9947.
 */
export function assertSelectedOrderMatchesInvoiceNumber(
  invoiceNumber: string | null | undefined,
  selected: { orderNumber: string; orderId?: string | null; leafLinkKey?: string | null },
): void {
  const tokens = splitInvoiceNumberTokens(invoiceNumber ?? undefined);
  if (!tokens.length) return;

  const orderKeys = [selected.orderNumber, selected.orderId, selected.leafLinkKey]
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  const orderNumber = String(selected.orderNumber || "").trim();

  let hadPostable = false;
  for (const tok of tokens) {
    const kind = classifyInvoiceTokenMatch(tok, orderKeys, orderNumber);
    if (invoiceMatchKindAllowsPost(kind)) hadPostable = true;
  }

  if (hadPostable) return;

  const hasFullCodeToken = tokens.some((t) => !isShortInvoiceStubToken(t));
  if (hasFullCodeToken) {
    throw new AppError(
      `Selected LeafLink order ${orderNumber || "(unknown)"} does not match the full invoice number on this entry (${tokens.join(", ")}). Use the exact order code (e.g. d83a10061).`,
      409,
      "LEAFLINK_INVOICE_ORDER_MISMATCH",
    );
  }

  throw new AppError(
    `Selected LeafLink order ${orderNumber || "(unknown)"} does not match invoice ${tokens.join(", ")} on this entry. Wrong-order posts are blocked.`,
    409,
    "LEAFLINK_INVOICE_ORDER_MISMATCH",
  );
}
