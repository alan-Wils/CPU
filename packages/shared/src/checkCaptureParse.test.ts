import { describe, expect, it } from "vitest";
import { extractPrimaryCheckAmount, parseCheckOcrTextWithConfidence } from "./checkCaptureParse.js";

describe("extractPrimaryCheckAmount", () => {
  it("prefers larger dollar amount over small noise", () => {
    expect(extractPrimaryCheckAmount("x 1.00 y $1,000.00 end")).toBe(1000);
  });

  it("handles comma grouping", () => {
    expect(extractPrimaryCheckAmount("Total 12,345.67 ok")).toBe(12345.67);
  });
});

describe("parseCheckOcrTextWithConfidence", () => {
  it("extracts date amount payee and MICR on a clean printed sample", () => {
    const raw = [
      "ACME GROW LLC",
      "PAY TO THE ORDER OF",
      "Telluride Bud Company",
      "One thousand and 00/100 dollars",
      "$ 1,000.00",
      "Memo: INV 10081",
      "01/20/2026",
      "123456789 12302075306 1001"
    ].join("\n");

    const r = parseCheckOcrTextWithConfidence(raw);
    expect(r.checkDate).toBe("2026-01-20");
    expect(r.amount).toBe(1000);
    expect(r.payerName).toContain("Telluride");
    expect(r.routingNumber).toBe("123456789");
    expect(r.accountNumber).toBe("12302075306");
    expect(r.confidenceByField.routingNumber).toBeGreaterThan(0.8);
    expect(r.parseQuality).toMatch(/strong|weak/);
  });

  it("returns weak or empty for garbage text", () => {
    const r = parseCheckOcrTextWithConfidence("@@@###");
    expect(r.parseQuality).toBe("empty");
  });

  it("handles handwritten-style noisy date", () => {
    const r = parseCheckOcrTextWithConfidence("Date 3/15/2025 smudge");
    expect(r.checkDate).toBe("2025-03-15");
  });
});
