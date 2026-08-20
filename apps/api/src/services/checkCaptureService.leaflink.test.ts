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

  it("warm-syncs LeafLink orders when refreshIfNoMatch and cache has no candidates", async () => {
    vi.spyOn(prisma.checkCapture, "findFirst").mockResolvedValue({
      id: "c1",
      amount: 2009.96,
      payerName: "The Dispo - REC",
      invoiceNumber: "d83a9949",
      leaflinkPaymentId: null,
      leaflinkOrderNumber: null,
      leaflinkPostedPayments: null,
    } as any);
    const find = (service as any).leafLinkOrdersService.findPaymentMatchCandidatesIncludingPaidForCheck as any;
    const warm = (service as any).leafLinkOrdersService.syncOrdersWarm as any;
    find.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        leafLinkKey: "d83a9949",
        orderId: "d83a9949",
        orderNumber: "d83a9949",
        customerName: "The Dispo - REC",
        total: 2010,
        outstandingBalance: 2010,
        status: "Approved",
        paymentStatus: "Unpaid",
        deliveryDate: null,
        lineItems: [],
        score: 50,
        matchedBy: ["invoice_last4"],
        markedPaidInLeafLink: false,
      },
    ]);
    warm.mockResolvedValue({ ok: true });
    const out = await service.matchLeafLinkInvoice("co1", "c1", { refreshIfNoMatch: true });
    expect(warm).toHaveBeenCalledWith("co1", "check_payment_match_refresh");
    expect(find).toHaveBeenCalledTimes(2);
    expect(out.possibleMatches).toHaveLength(1);
    expect(out.possibleMatches[0].outstandingBalance).toBe(2010);
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
    expect((service as any).leafLinkOrdersService.postOrderPayment).toHaveBeenCalledWith(
      "co1",
      expect.objectContaining({
        orderNumber: "INV-1",
        amount: 100,
        paymentMethod: "Check",
        paymentDateIso: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
    const postedArg = ((service as any).leafLinkOrdersService.postOrderPayment as any).mock.calls[0][1];
    /** Default payment date is today/received — not the check written date (2026-05-01). */
    expect(postedArg.paymentDateIso).not.toBe("2026-05-01");
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leaflinkPaidAt: expect.any(Date),
          paymentSyncStatus: "payment_posted",
        }),
      }),
    );
  });

  it("posts with document payment date when paymentDateSource=document", async () => {
    vi.spyOn(prisma.checkCapture, "findFirst").mockResolvedValue({
      id: "c1",
      checkDate: new Date("2026-05-01T00:00:00.000Z"),
      checkNumber: "1001",
      amount: 100,
      payerName: "Acme",
      invoiceNumber: "INV-1",
      leaflinkPaymentId: null,
      leaflinkPostedPayments: null,
    } as any);
    vi.spyOn(prisma.checkCapture, "update").mockResolvedValue({ id: "c1" } as any);
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
    await service.markLeafLinkInvoicePaid("co1", "u1", "c1", {
      orderNumber: "INV-1",
      paymentDateSource: "document",
    });
    expect((service as any).leafLinkOrdersService.postOrderPayment).toHaveBeenCalledWith(
      "co1",
      expect.objectContaining({
        paymentDateIso: "2026-05-01",
      }),
    );
  });

  it("posts partial payment amount without marking check fully paid in LeafLink", async () => {
    vi.spyOn(prisma.checkCapture, "findFirst").mockResolvedValue({
      id: "c1",
      checkDate: new Date("2026-05-01T00:00:00.000Z"),
      checkNumber: "1001",
      amount: 40,
      payerName: "Acme",
      invoiceNumber: "INV-1",
      leaflinkPaymentId: null,
      leaflinkPostedPayments: null,
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
      paymentId: "p-partial",
      paymentStatus: "posted",
      rawResponse: { id: "p-partial" },
    });
    const out = await service.markLeafLinkInvoicePaid("co1", "u1", "c1", {
      orderNumber: "INV-1",
      paymentAmount: 40,
      allowAmountOverride: true,
      overrideNote: "Partial payment on account",
    });
    expect(out.ok).toBe(true);
    expect((service as any).leafLinkOrdersService.postOrderPayment).toHaveBeenCalledWith(
      "co1",
      expect.objectContaining({ amount: 40 }),
    );
    const data = updateSpy.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data.paymentSyncStatus).toBe("payment_posted");
    expect(data.leaflinkPaidAt).toBeUndefined();
  });

  it("blocks overpaying an invoice even with override", async () => {
    vi.spyOn(prisma.checkCapture, "findFirst").mockResolvedValue({
      id: "c1",
      checkDate: null,
      checkNumber: null,
      amount: 1000,
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
        total: 960.15,
        outstandingBalance: 960.15,
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
        paymentAmount: 1000,
        allowAmountOverride: true,
        overrideNote: "trying to apply whole check",
      }),
    ).rejects.toMatchObject({ code: "CHECK_OVERPAY_BLOCKED" } satisfies Partial<AppError>);
  });
});
