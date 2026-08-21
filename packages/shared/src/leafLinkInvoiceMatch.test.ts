import { describe, expect, it } from "vitest";
import {
  classifyInvoiceTokenMatch,
  invoiceMatchKindAllowsPost,
  isShortInvoiceStubToken,
  normalizeInvoiceOrderKey,
  splitInvoiceNumberTokens,
  trailingNumericInvoicePortion,
} from "./leafLinkInvoiceMatch.js";

describe("LeafLink invoice matching", () => {
  it("normalizes full invoice codes like d83a10061", () => {
    expect(normalizeInvoiceOrderKey("d83a10061")).toBe("d83a10061");
    expect(normalizeInvoiceOrderKey("#D83A10061")).toBe("d83a10061");
    expect(normalizeInvoiceOrderKey(" d83a-10061 ")).toBe("d83a10061");
  });

  it("extracts the complete trailing numeric portion, not a fixed slice", () => {
    expect(trailingNumericInvoicePortion("d83a10061")).toBe("10061");
    expect(trailingNumericInvoicePortion("d83a9963")).toBe("9963");
    expect(trailingNumericInvoicePortion("d83a20061")).toBe("20061");
    expect(trailingNumericInvoicePortion("#D83A-10061")).toBe("10061");
  });

  it("treats four- and five-digit invoice numbers as stubs, not full order codes", () => {
    expect(isShortInvoiceStubToken("d83a10061")).toBe(false);
    expect(isShortInvoiceStubToken("d83a9862")).toBe(false);
    expect(isShortInvoiceStubToken("10061")).toBe(true);
    expect(isShortInvoiceStubToken("9963")).toBe(true);
    expect(isShortInvoiceStubToken("9862")).toBe(true);
    expect(isShortInvoiceStubToken("831")).toBe(true);
  });

  it("matches 10061 to d83a10061 and not d83a20061", () => {
    expect(classifyInvoiceTokenMatch("10061", ["d83a10061"], "d83a10061")).toBe("invoice_last4");
    expect(invoiceMatchKindAllowsPost(classifyInvoiceTokenMatch("10061", ["d83a10061"], "d83a10061"))).toBe(
      true,
    );
    expect(classifyInvoiceTokenMatch("10061", ["d83a20061"], "d83a20061")).toBeNull();
    expect(invoiceMatchKindAllowsPost(classifyInvoiceTokenMatch("10061", ["d83a20061"], "d83a20061"))).toBe(
      false,
    );
  });

  it("preserves four-digit trailing matches", () => {
    expect(classifyInvoiceTokenMatch("9963", ["d83a9963"], "d83a9963")).toBe("invoice_last4");
    expect(classifyInvoiceTokenMatch("9862", ["d83a9862"], "d83a9862")).toBe("invoice_last4");
  });

  it("matches whole invoice number exactly for full codes", () => {
    expect(classifyInvoiceTokenMatch("d83a10061", ["d83a10061"], "d83a10061")).toBe("invoice_exact");
    expect(classifyInvoiceTokenMatch("d83a9862", ["d83a9862"], "d83a9862")).toBe("invoice_exact");
    expect(classifyInvoiceTokenMatch("d83a9862", ["d83a9831"], "d83a9831")).toBeNull();
    expect(classifyInvoiceTokenMatch("d83a10061", ["d83a20061"], "d83a20061")).toBeNull();
  });

  it("rejects partial or incorrect invoice values", () => {
    expect(classifyInvoiceTokenMatch("0061", ["d83a10061"], "d83a10061")).toBeNull();
    expect(classifyInvoiceTokenMatch("1006", ["d83a10061"], "d83a10061")).toBeNull();
    expect(classifyInvoiceTokenMatch("061", ["d83a10061"], "d83a10061")).toBeNull();
    expect(classifyInvoiceTokenMatch("996", ["d83a9963"], "d83a9963")).toBeNull();
    expect(classifyInvoiceTokenMatch("9849", ["d83a9947"], "d83a9947")).toBeNull();
  });

  it("does not partial-match digit stubs against UUID ids", () => {
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

  it("splits multiple invoice numbers on commas, spaces, and line breaks", () => {
    expect(splitInvoiceNumberTokens("d83a9831, d83a9834")).toEqual(["d83a9831", "d83a9834"]);
    expect(splitInvoiceNumberTokens("9908, 9962, 9924")).toEqual(["9908", "9962", "9924"]);
    expect(splitInvoiceNumberTokens("10061\n9963")).toEqual(["10061", "9963"]);
    expect(splitInvoiceNumberTokens("10061\n9449, 9448")).toEqual(["10061", "9449", "9448"]);
    expect(splitInvoiceNumberTokens("  10061  ,  9963 \n 9908 ")).toEqual(["10061", "9963", "9908"]);
    expect(splitInvoiceNumberTokens("9908 9962")).toEqual(["9908", "9962"]);
  });

  it("classifies mixed four- and five-digit multi-invoice tokens against the matching order", () => {
    const tokens = splitInvoiceNumberTokens("9908, 10061, 9963");
    expect(tokens).toEqual(["9908", "10061", "9963"]);
    expect(classifyInvoiceTokenMatch("9908", ["d83a9908"], "d83a9908")).toBe("invoice_last4");
    expect(classifyInvoiceTokenMatch("10061", ["d83a10061"], "d83a10061")).toBe("invoice_last4");
    expect(classifyInvoiceTokenMatch("9963", ["d83a9963"], "d83a9963")).toBe("invoice_last4");
    expect(classifyInvoiceTokenMatch("10061", ["d83a9908"], "d83a9908")).toBeNull();
  });
});
