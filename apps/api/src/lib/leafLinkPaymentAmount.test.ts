import { describe, expect, it } from "vitest";
import {
  buildLeafLinkCpuPaymentNote,
  leafLinkOrderOwedAmount,
  leafLinkPaymentMatchesInvoice,
  resolveLeafLinkPaymentDateIso,
  sameLeafLinkMoney,
  todayLocalIsoDate,
} from "./leafLinkPaymentAmount.js";

describe("leafLinkPaymentAmount", () => {
  it("sameLeafLinkMoney tolerates penny drift", () => {
    expect(sameLeafLinkMoney(100, 100.005)).toBe(true);
    expect(sameLeafLinkMoney(100, 100.02)).toBe(false);
  });

  it("leafLinkOrderOwedAmount prefers outstanding balance", () => {
    expect(leafLinkOrderOwedAmount({ outstandingBalance: 50, total: 100 })).toBe(50);
    expect(leafLinkOrderOwedAmount({ outstandingBalance: null, total: 100 })).toBe(100);
  });

  it("leafLinkPaymentMatchesInvoice accepts owed or total", () => {
    expect(leafLinkPaymentMatchesInvoice(100, 100, 120)).toBe(true);
    expect(leafLinkPaymentMatchesInvoice(120, 100, 120)).toBe(true);
    expect(leafLinkPaymentMatchesInvoice(90, 100, 120)).toBe(false);
  });

  it("capLeafLinkPaymentToOwed never exceeds invoice balance", async () => {
    const { capLeafLinkPaymentToOwed, assertLeafLinkPaymentDoesNotOverpay } = await import(
      "./leafLinkPaymentAmount.js"
    );
    expect(capLeafLinkPaymentToOwed(1000, 960.15)).toBe(960.15);
    expect(capLeafLinkPaymentToOwed(900, 960.15)).toBe(900);
    expect(capLeafLinkPaymentToOwed(960.15, 960.15)).toBe(960.15);
    expect(() => assertLeafLinkPaymentDoesNotOverpay(1000, 960.15)).toThrow(/cannot exceed/i);
    expect(() => assertLeafLinkPaymentDoesNotOverpay(960.15, 960.15)).not.toThrow();
    expect(() => assertLeafLinkPaymentDoesNotOverpay(900, 960.15)).not.toThrow();
  });

  it("buildLeafLinkCpuPaymentNote appends override reason", () => {
    expect(buildLeafLinkCpuPaymentNote("CPU check capture c1", false)).toBe("CPU check capture c1");
    expect(buildLeafLinkCpuPaymentNote("CPU check capture c1", true, "partial payment")).toContain(
      "partial payment",
    );
  });

  it("resolveLeafLinkPaymentDateIso defaults to today/received, not document date", () => {
    const now = new Date(2026, 7, 20, 15, 0, 0); // local Aug 20 2026
    expect(
      resolveLeafLinkPaymentDateIso({
        documentDate: new Date("2026-07-30T12:00:00.000Z"),
        now,
      }),
    ).toBe(todayLocalIsoDate(now));
    expect(
      resolveLeafLinkPaymentDateIso({
        paymentDateSource: "received",
        documentDate: new Date("2026-07-30T12:00:00.000Z"),
        now,
      }),
    ).toBe(todayLocalIsoDate(now));
    expect(
      resolveLeafLinkPaymentDateIso({
        paymentDateSource: "document",
        documentDate: new Date("2026-07-30T12:00:00.000Z"),
        now,
      }),
    ).toBe("2026-07-30");
  });
});
