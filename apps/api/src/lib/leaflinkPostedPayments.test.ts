import { describe, expect, it } from "vitest";
import {
  formatPostedLeafLinkOrderNumbers,
  mergePostedPaymentsFromCheckCapture,
  parsePostedPaymentsJson,
} from "./leaflinkPostedPayments.js";

describe("leaflinkPostedPayments", () => {
  it("parses multi-invoice posted payment rows", () => {
    const rows = parsePostedPaymentsJson([
      { orderNumber: "d83a9884", paymentId: "1", amount: 900, postedAt: "2026-08-05T00:00:00.000Z" },
      { orderNumber: "d83a9870", paymentId: "2", amount: 504, postedAt: "2026-08-05T00:00:00.000Z" },
      { orderNumber: "d83a9871", paymentId: "3", amount: 504, postedAt: "2026-08-05T00:00:00.000Z" },
    ]);
    expect(rows).toHaveLength(3);
    expect(formatPostedLeafLinkOrderNumbers(rows)).toBe("#d83a9884, #d83a9870, #d83a9871");
  });

  it("falls back to legacy single payment columns", () => {
    const merged = mergePostedPaymentsFromCheckCapture({
      leaflinkPostedPayments: null,
      leaflinkOrderNumber: "d83a9871",
      leaflinkPaymentId: "4420191",
      amount: 504,
    });
    expect(merged).toEqual([
      expect.objectContaining({ orderNumber: "d83a9871", paymentId: "4420191", amount: 504 }),
    ]);
    expect(formatPostedLeafLinkOrderNumbers(merged)).toBe("#d83a9871");
  });
});
