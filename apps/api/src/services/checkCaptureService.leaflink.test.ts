import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { CheckCaptureService } from "./checkCaptureService.js";

describe("CheckCaptureService LeafLink sync", () => {
  const service = new CheckCaptureService();

  beforeEach(() => {
    vi.restoreAllMocks();
    // Replace networked dependencies with controlled stubs.
    (service as any).leafLinkOrdersService = {
      findOpenPaymentCandidatesForCheck: vi.fn(),
      findPaymentMatchCandidatesIncludingPaidForCheck: vi.fn(),
      syncOrdersWarm: vi.fn(),
      postOrderPayment: vi.fn(),
    };
    (service as any).auditService = {
      logAction: vi.fn(),
    };
  });

  it("returns exact invoice match", async () => {
    vi.spyOn(prisma.checkCapture, "findFirst").mockResolvedValue({
      id: "c1",
      amount: 100,
      payerName: "Acme",
      invoiceNumber: "INV-123",
      leaflinkPaymentId: null,
    } as any);
    vi.spyOn(prisma.checkCapture, "update").mockResolvedValue({ id: "c1" } as any);
    const cand = {
      leafLinkKey: "ll1",
      orderId: "o1",
      orderNumber: "INV-123",
      customerName: "Acme",
      total: 100,
      outstandingBalance: 100,
      status: "Submitted",
      paymentStatus: "Unpaid",
      deliveryDate: null,
      lineItems: [],
      score: 100,
      matchedBy: ["invoice_exact"],
      markedPaidInLeafLink: false,
    };
    ((service as any).leafLinkOrdersService.findPaymentMatchCandidatesIncludingPaidForCheck as any).mockResolvedValue([
      cand,
    ]);
    const out = await service.matchLeafLinkInvoice("co1", "c1", {});
    expect(out.exactMatches).toHaveLength(1);
    expect(out.possibleMatches).toHaveLength(0);
    expect(out.linkedOrders).toEqual([cand]);
  });

  it("returns multiple possible fallback matches", async () => {
    vi.spyOn(prisma.checkCapture, "findFirst").mockResolvedValue({
      id: "c1",
      amount: 100,
      payerName: "Acme",
      invoiceNumber: null,
      leaflinkPaymentId: null,
    } as any);
    vi.spyOn(prisma.checkCapture, "update").mockResolvedValue({ id: "c1" } as any);
    const a = {
      leafLinkKey: "ll1",
      orderId: "o1",
      orderNumber: "A-1",
      customerName: "Acme Distribution",
      total: 100,
      outstandingBalance: 100,
      status: "Submitted",
      paymentStatus: "Unpaid",
      deliveryDate: null,
      lineItems: [],
      score: 40,
      matchedBy: ["payee_name", "amount"],
      markedPaidInLeafLink: false,
    };
    const b = {
      leafLinkKey: "ll2",
      orderId: "o2",
      orderNumber: "A-2",
      customerName: "Acme Distribution",
      total: 100,
      outstandingBalance: 100,
      status: "Submitted",
      paymentStatus: "Unpaid",
      deliveryDate: null,
      lineItems: [],
      score: 39,
      matchedBy: ["payee_name", "amount"],
      markedPaidInLeafLink: false,
    };
    ((service as any).leafLinkOrdersService.findPaymentMatchCandidatesIncludingPaidForCheck as any).mockResolvedValue([
      a,
      b,
    ]);
    const out = await service.matchLeafLinkInvoice("co1", "c1", {});
    expect(out.exactMatches).toHaveLength(0);
    expect(out.possibleMatches).toHaveLength(2);
    expect(out.linkedOrders).toHaveLength(2);
  });

  it("returns no match when candidates are absent", async () => {
    vi.spyOn(prisma.checkCapture, "findFirst").mockResolvedValue({
      id: "c1",
      amount: 100,
      payerName: "Acme",
      invoiceNumber: "NOPE",
      leaflinkPaymentId: null,
    } as any);
    ((service as any).leafLinkOrdersService.findPaymentMatchCandidatesIncludingPaidForCheck as any).mockResolvedValue([]);
    const out = await service.matchLeafLinkInvoice("co1", "c1", {});
    expect(out.exactMatches).toHaveLength(0);
    expect(out.possibleMatches).toHaveLength(0);
    expect(out.linkedOrders).toHaveLength(0);
  });

  it("blocks duplicate payment post", async () => {
    vi.spyOn(prisma.checkCapture, "findFirst").mockResolvedValue({
      id: "c1",
      checkDate: null,
      checkNumber: null,
      amount: 100,
      payerName: "Acme",
      invoiceNumber: "INV-1",
      leaflinkPaymentId: "existing-payment",
      leaflinkOrderNumber: "INV-1",
      leaflinkPostedPayments: null,
    } as any);
    ((service as any).leafLinkOrdersService.findOpenPaymentCandidatesForCheck as any).mockResolvedValue([
      {
        leafLinkKey: "ll1",
        orderId: "o1",
        orderNumber: "INV-1",
        customerName: "Acme",
        total: 100,
        outstandingBalance: 100,
        status: "Submitted",
        paymentStatus: "Unpaid",
        deliveryDate: null,
        lineItems: [],
        score: 100,
        matchedBy: ["invoice_exact"],
        markedPaidInLeafLink: false,
      },
    ]);
    await expect(
      service.markLeafLinkInvoicePaid("co1", "u1", "c1", { orderNumber: "INV-1" }),
    ).rejects.toMatchObject({ code: "CHECK_LEAFLINK_DUPLICATE_ORDER" } satisfies Partial<AppError>);
  });

  it("requires override note when allowAmountOverride is set", async () => {
    vi.spyOn(prisma.checkCapture, "findFirst").mockResolvedValue({
      id: "c1",
      checkDate: null,
      checkNumber: null,
      amount: 90,
      payerName: "Acme",
      invoiceNumber: "INV-1",
      leaflinkPaymentId: null,
    } as any);
    ((service as any).leafLinkOrdersService.findOpenPaymentCandidatesForCheck as any).mockResolvedValue([
      {
        leafLinkKey: "ll1",
        orderId: "o1",
        orderNumber: "INV-1",
        customerName: "Acme",
        total: 100,
        outstandingBalance: 100,
        status: "Submitted",
        paymentStatus: "Unpaid",
        deliveryDate: null,
        lineItems: [],
        score: 100,
        matchedBy: ["invoice_exact"],
        markedPaidInLeafLink: false,
      },
    ]);
    await expect(
      service.markLeafLinkInvoicePaid("co1", "u1", "c1", {
        orderNumber: "INV-1",
        paymentAmount: 90,
        allowAmountOverride: true,
      }),
    ).rejects.toMatchObject({ code: "CHECK_OVERRIDE_NOTE_REQUIRED" } satisfies Partial<AppError>);
  });

  it("blocks amount mismatch without override", async () => {
    vi.spyOn(prisma.checkCapture, "findFirst").mockResolvedValue({
      id: "c1",
      checkDate: null,
      checkNumber: null,
      amount: 90,
      payerName: "Acme",
      invoiceNumber: "INV-1",
      leaflinkPaymentId: null,
    } as any);
    ((service as any).leafLinkOrdersService.findOpenPaymentCandidatesForCheck as any).mockResolvedValue([
      {
        leafLinkKey: "ll1",
        orderId: "o1",
        orderNumber: "INV-1",
        customerName: "Acme",
        total: 100,
        outstandingBalance: 100,
        status: "Submitted",
        paymentStatus: "Unpaid",
        deliveryDate: null,
        lineItems: [],
        score: 100,
        matchedBy: ["invoice_exact"],
        markedPaidInLeafLink: false,
      },
    ]);
    await expect(
      service.markLeafLinkInvoicePaid("co1", "u1", "c1", {
        orderNumber: "INV-1",
        paymentAmount: 90,
      }),
    ).rejects.toMatchObject({ code: "CHECK_AMOUNT_MISMATCH" } satisfies Partial<AppError>);
  });

  it("posts payment successfully and updates check capture", async () => {
    vi.spyOn(prisma.checkCapture, "findFirst").mockResolvedValue({
      id: "c1",
      checkDate: new Date("2026-05-01T00:00:00.000Z"),
      checkNumber: "1001",
      amount: 100,
      payerName: "Acme",
      invoiceNumber: "INV-1",
      leaflinkPaymentId: null,
    } as any);
    const updateSpy = vi.spyOn(prisma.checkCapture, "update").mockResolvedValue({ id: "c1" } as any);
    ((service as any).leafLinkOrdersService.findOpenPaymentCandidatesForCheck as any).mockResolvedValue([
      {
        leafLinkKey: "ll1",
        orderId: "o1",
        orderNumber: "INV-1",
        customerName: "Acme",
        total: 100,
        outstandingBalance: 100,
        status: "Submitted",
        paymentStatus: "Unpaid",
        deliveryDate: null,
        lineItems: [],
        score: 100,
        matchedBy: ["invoice_exact"],
        markedPaidInLeafLink: false,
      },
    ]);
    ((service as any).leafLinkOrdersService.postOrderPayment as any).mockResolvedValue({
      paymentId: "p1",
      paymentStatus: "posted",
      rawResponse: { id: "p1", status: "posted" },
    });
    const out = await service.markLeafLinkInvoicePaid("co1", "u1", "c1", { orderNumber: "INV-1" });
    expect(out.ok).toBe(true);
    expect(updateSpy).toHaveBeenCalled();
  });
});
