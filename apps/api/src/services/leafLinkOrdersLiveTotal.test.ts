import { describe, expect, it } from "vitest";
import {
  normalizeOrder,
  resolveLeafLinkOrderTotalUsdFromStoredPayload,
} from "./leafLinkOrdersService.js";

const CPU_DETAIL_V = 1 as const;

/** LeafLink GET /orders-received/ row shape (total is `{ amount, currency }`). */
const LEAFLINK_ORDER_RECEIVED_ROW = {
  number: "aec108ac-a1f4-40fa-966e-a12ga9bf6e2f",
  created_on: "2026-05-26T15:15:03.776119-06:00",
  customer: { display_name: "Terrapin Care Station - Manhattan Rec" },
  total: { amount: 1842.5, currency: "USD" },
  payment_balance: 1842.5,
  line_items: [],
};

describe("resolveLeafLinkOrderTotalUsdFromStoredPayload", () => {
  it("reads total.amount from LeafLink orders-received JSON", () => {
    expect(resolveLeafLinkOrderTotalUsdFromStoredPayload(LEAFLINK_ORDER_RECEIVED_ROW, null)).toBe(
      1842.5,
    );
  });

  it("reads total from CPU detail wrapper payload stored after order detail sync", () => {
    const summary = normalizeOrder(LEAFLINK_ORDER_RECEIVED_ROW);
    const boxed = { _cpu_v: CPU_DETAIL_V, summary };
    expect(resolveLeafLinkOrderTotalUsdFromStoredPayload(boxed, null)).toBe(1842.5);
  });

  it("prefers positive stored totalUsd when present", () => {
    expect(resolveLeafLinkOrderTotalUsdFromStoredPayload(LEAFLINK_ORDER_RECEIVED_ROW, 99.99)).toBe(
      99.99,
    );
  });

  it("recomputes when stored totalUsd is zero but payload has LeafLink total", () => {
    expect(resolveLeafLinkOrderTotalUsdFromStoredPayload(LEAFLINK_ORDER_RECEIVED_ROW, 0)).toBe(
      1842.5,
    );
  });

  it("falls back to payment_balance when total.amount is zero", () => {
    const row = {
      ...LEAFLINK_ORDER_RECEIVED_ROW,
      total: { amount: 0, currency: "USD" },
      payment_balance: 512.25,
    };
    expect(resolveLeafLinkOrderTotalUsdFromStoredPayload(row, null)).toBe(512.25);
  });

  it("normalizeOrder keeps order total separate from remaining payment_balance", () => {
    const o = normalizeOrder({
      ...LEAFLINK_ORDER_RECEIVED_ROW,
      total: { amount: 1000, currency: "USD" },
      payment_balance: 250,
      paid: false,
    });
    expect(o.total).toBe(1000);
    expect(o.outstandingBalance).toBe(250);
  });

  it("normalizeOrder reads $0 outstanding when fully paid down", () => {
    const o = normalizeOrder({
      ...LEAFLINK_ORDER_RECEIVED_ROW,
      total: { amount: 1000, currency: "USD" },
      payment_balance: 0,
      paid: false,
    });
    expect(o.outstandingBalance).toBe(0);
  });
});
