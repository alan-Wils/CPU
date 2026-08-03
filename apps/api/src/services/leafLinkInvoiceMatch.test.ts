import { describe, expect, it } from "vitest";
import {
  classifyInvoiceTokenMatch,
  isShortInvoiceStubToken,
  normalizeInvoiceOrderKey,
  normalizeOrder,
  splitInvoiceNumberTokens,
} from "./leafLinkOrdersService.js";
import { hasPostedOrderNumber } from "../lib/leaflinkPostedPayments.js";

describe("LeafLink invoice matching keys", () => {
  it("normalizes full invoice codes like d83a9862", () => {
    expect(normalizeInvoiceOrderKey("d83a9862")).toBe("d83a9862");
    expect(normalizeInvoiceOrderKey("#D83A9862")).toBe("d83a9862");
    expect(normalizeInvoiceOrderKey(" d83a-9862 ")).toBe("d83a9862");
  });

  it("treats full codes as not short stubs", () => {
    expect(isShortInvoiceStubToken("d83a9862")).toBe(false);
    expect(isShortInvoiceStubToken("9862")).toBe(true);
    expect(isShortInvoiceStubToken("831")).toBe(true);
  });

  it("matches whole invoice number exactly and not last4 for full codes", () => {
    expect(classifyInvoiceTokenMatch("d83a9862", ["d83a9862"], "d83a9862")).toBe("invoice_exact");
    expect(classifyInvoiceTokenMatch("d83a9862", ["d83a9831"], "d83a9831")).toBeNull();
    expect(classifyInvoiceTokenMatch("9862", ["d83a9862"], "d83a9862")).toBe("invoice_last4");
  });

  it("does not partial-match digit stubs against UUID ids (Epic Remedy false positive)", () => {
    const uuidContaining9632 = "aec108ac-a1f4-40fa-9632-a12fa9bf6e2f";
    expect(
      classifyInvoiceTokenMatch("9632", ["d83a9547", uuidContaining9632], "d83a9547"),
    ).toBeNull();
    expect(
      classifyInvoiceTokenMatch("9632", ["d83a9632", uuidContaining9632], "d83a9632"),
    ).toBe("invoice_last4");
  });

  it("still allows short alphanumeric prefix partial against order numbers only", () => {
    expect(
      classifyInvoiceTokenMatch("d83a", ["d83a9547", "aec108aca1f440fa9632a12fa9bf6e2f"], "d83a9547"),
    ).toBe("invoice_partial");
  });

  it("splits multiple invoice numbers", () => {
    expect(splitInvoiceNumberTokens("d83a9831, d83a9834")).toEqual(["d83a9831", "d83a9834"]);
  });

  it("normalizeOrder keeps seller order number for exact invoice match", () => {
    const o = normalizeOrder({
      number: "aec108ac-a1f4-40fa-966e-a12ga9bf6e2f",
      external_id_seller: "d83a9862",
      customer: { display_name: "Solace" },
      total: { amount: 100, currency: "USD" },
      payment_balance: 100,
      paid: false,
      line_items: [],
    });
    expect(normalizeInvoiceOrderKey(o.orderNumber)).toBe("d83a9862");
  });

  it("hasPostedOrderNumber blocks normalized duplicates", () => {
    expect(
      hasPostedOrderNumber(
        [{ orderNumber: "d83a9862", paymentId: "p1", amount: 10, postedAt: "2026-01-01" }],
        "D83A9862",
      ),
    ).toBe(true);
    expect(
      hasPostedOrderNumber(
        [{ orderNumber: "d83a9862", paymentId: "p1", amount: 10, postedAt: "2026-01-01" }],
        "d83a9999",
      ),
    ).toBe(false);
  });

  it("assertSelectedOrderMatchesInvoiceNumber blocks 9849 onto 9947", async () => {
    const { assertSelectedOrderMatchesInvoiceNumber } = await import("./leafLinkOrdersService.js");
    expect(() =>
      assertSelectedOrderMatchesInvoiceNumber("9849", {
        orderNumber: "d83a9947",
        orderId: "o1",
      }),
    ).toThrow(/does not match invoice/);
    expect(() =>
      assertSelectedOrderMatchesInvoiceNumber("d83a9849", {
        orderNumber: "d83a9947",
        orderId: "o1",
      }),
    ).toThrow(/full invoice number/);
    expect(() =>
      assertSelectedOrderMatchesInvoiceNumber("d83a9849", {
        orderNumber: "d83a9849",
        orderId: "o1",
      }),
    ).not.toThrow();
    expect(() =>
      assertSelectedOrderMatchesInvoiceNumber("9849", {
        orderNumber: "d83a9849",
        orderId: "o1",
      }),
    ).not.toThrow();
  });
});
