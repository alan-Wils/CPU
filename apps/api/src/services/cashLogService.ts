import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import type { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";
import {
    objectKeyFromParts,
    putUploadObject,
    removeStoredUpload,
    requirePersistentUploadsInProduction,
    uploadsUseS3
} from "../lib/uploadStorage.js";
import { logDatabaseActivity, recordUsageEventSafe } from "./usageEventRecord.js";
import {
    hasPostedOrderNumber,
    parsePostedPaymentsJson,
    type LeafLinkPostedPaymentRow,
} from "../lib/leaflinkPostedPayments.js";
import { buildLeafLinkCpuPaymentNote } from "../lib/leafLinkPaymentAmount.js";
import { AuditService } from "./auditService.js";
import { findRecentLeafLinkStoredOrdersForCompany } from "./leafLinkOrdersStorePrimitives.js";
import {
    LeafLinkOrdersService,
    type LeafLinkPaymentMatchCandidateDto,
    summarizeLeafLinkInvoiceFromStoredRows,
} from "./leafLinkOrdersService.js";

export type CashLeafLinkMatchResult = {
    cashEntryId: string;
    loggedPaymentAmount: number | null;
    exactMatches: LeafLinkPaymentMatchCandidateDto[];
    possibleMatches: LeafLinkPaymentMatchCandidateDto[];
    linkedOrders: LeafLinkPaymentMatchCandidateDto[];
};

function extForReceiptMime(mimeType: string) {
    if (mimeType === "image/png")
        return "png";
    if (mimeType === "image/webp")
        return "webp";
    return "jpg";
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function parseUtcDayStart(isoDate: string | undefined) {
    if (!isoDate || !ISO_DATE.test(String(isoDate).trim()))
        return undefined;
    const [y, m, d] = String(isoDate).split("-").map((n) => Number(n));
    if (!y || !m || !d)
        return undefined;
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}
function parseUtcDayEnd(isoDate: string | undefined) {
    if (!isoDate || !ISO_DATE.test(String(isoDate).trim()))
        return undefined;
    const [y, m, d] = String(isoDate).split("-").map((n) => Number(n));
    if (!y || !m || !d)
        return undefined;
    return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
}
/** UTC calendar-day bounds for optional `from` / `to` (YYYY-MM-DD). */
function buildUtcDayRange(opts: { from?: string; to?: string } | undefined) {
    const from = opts?.from ? parseUtcDayStart(opts.from) : undefined;
    const to = opts?.to ? parseUtcDayEnd(opts.to) : undefined;
    if (!from && !to)
        return undefined;
    if (from && to && from > to) {
        throw new AppError("`from` date must be on or before `to` date", 400, "CASH_LOG_DATE_RANGE_INVALID");
    }
    return {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {})
    };
}

/**
 * History / export: match **entry date** when set; rows with no entry date still appear if **logged**
 * (`createdAt`) falls in the range (legacy / outgoing-without-date).
 */
function whereEntryDateOrLegacyCreated(range: { gte?: Date; lte?: Date }): Prisma.CashLogEntryWhereInput {
    return {
        OR: [
            { entryDate: range },
            { AND: [{ entryDate: null }, { createdAt: range }] }
        ]
    };
}
function csvEscape(value: unknown) {
    const s = value == null ? "" : String(value);
    if (/[",\r\n]/.test(s))
        return `"${s.replace(/"/g, '""')}"`;
    return s;
}

const PAY_TOLERANCE = 0.01;
function sameMoneyCash(a: number, b: number) {
    return Math.abs(Number(a || 0) - Number(b || 0)) <= PAY_TOLERANCE;
}

export class CashLogService {
    leafLinkOrdersService = new LeafLinkOrdersService();
    auditService = new AuditService();
    async uploadReceiptImage(input: {
        companyId: string;
        fileName?: string | null;
        mimeType: string;
        dataBase64: string;
        origin: string;
    }) {
        const base64 = String(input.dataBase64 || "").replace(/^data:[^;]+;base64,/, "");
        const buffer = Buffer.from(base64, "base64");
        if (!buffer.length) {
            throw new AppError("Invalid receipt image data", 400, "CASH_RECEIPT_IMAGE_INVALID");
        }
        if (buffer.length > env.CHECK_UPLOAD_MAX_BYTES) {
            throw new AppError(`Image exceeds ${env.CHECK_UPLOAD_MAX_BYTES} byte limit`, 413, "CASH_RECEIPT_IMAGE_TOO_LARGE");
        }
        requirePersistentUploadsInProduction();
        const ext = extForReceiptMime(String(input.mimeType || ""));
        const safeName = `${Date.now()}-${randomUUID().slice(0, 12)}.${ext}`;
        const mime = String(input.mimeType || "").includes("png")
            ? "image/png"
            : String(input.mimeType || "").includes("webp")
              ? "image/webp"
              : "image/jpeg";
        if (uploadsUseS3()) {
            const key = objectKeyFromParts("cash-receipts", input.companyId, safeName);
            await putUploadObject(key, buffer, mime);
            void recordUsageEventSafe({
                companyId: input.companyId,
                provider: "cloudflare_r2",
                feature: "cash_receipt_upload",
                unitType: "upload_bytes",
                units: buffer.length,
                estimatedCost: Math.max(0.0005, (buffer.length / (1024 * 1024)) * 0.02),
            });
            return {
                imageUrl: `${input.origin}/uploads/cash-receipts/${input.companyId}/${safeName}`,
                bytes: buffer.length
            };
        }
        const directory = path.join(process.cwd(), "uploads", "cash-receipts", input.companyId);
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, safeName), buffer);
        return {
            imageUrl: `${input.origin}/uploads/cash-receipts/${input.companyId}/${safeName}`,
            bytes: buffer.length
        };
    }

    async create(input: {
        companyId: string;
        createdByUserId: string;
        direction: "INCOMING" | "OUTGOING";
        amount: number;
        memo?: string | null;
        entryDate?: Date | null;
        payeeCompany?: string | null;
        invoiceNumber?: string | null;
        department?: "CULTIVATION" | "EXTRACTION" | "PACKAGING" | "GENERAL" | null;
        receiptImageUrl?: string | null;
    }) {
        const incoming = input.direction === "INCOMING";
        const row = await prisma.cashLogEntry.create({
            data: {
                companyId: input.companyId,
                createdByUserId: input.createdByUserId,
                direction: input.direction,
                amount: input.amount,
                memo: input.memo ?? undefined,
                entryDate: input.entryDate ?? undefined,
                payeeCompany: incoming ? String(input.payeeCompany || "").trim() || undefined : undefined,
                invoiceNumber: incoming
                    ? (String(input.invoiceNumber || "").trim() || undefined)
                    : undefined,
                department: !incoming ? input.department ?? undefined : undefined,
                receiptImageUrl: !incoming && input.receiptImageUrl
                    ? String(input.receiptImageUrl).trim() || undefined
                    : undefined
            },
            select: {
                id: true,
                companyId: true,
                createdByUserId: true,
                direction: true,
                amount: true,
                payeeCompany: true,
                invoiceNumber: true,
                department: true,
                memo: true,
                entryDate: true,
                receiptImageUrl: true,
                createdAt: true,
                updatedAt: true
            }
        });
        void logDatabaseActivity({
            companyId: input.companyId,
            feature: "cash_log_entry_create",
            dbWrites: 1,
            rowsWritten: 1,
            queryCount: 1,
            metadata: { table: "cash_log_entry", op: "insert" },
        });
        return row;
    }
    async updateById(companyId: string, id: string, patch: {
        amount?: number;
        memo?: string | null;
        payeeCompany?: string | null;
        invoiceNumber?: string | null;
        department?: "CULTIVATION" | "EXTRACTION" | "PACKAGING" | "GENERAL" | null;
        entryDate?: Date | null;
        receiptImageUrl?: string | null;
    }) {
        const row = await prisma.cashLogEntry.findFirst({
            where: {
                id,
                companyId
            },
            select: {
                id: true,
                direction: true,
                receiptImageUrl: true
            }
        });
        if (!row) {
            throw new AppError("Cash log entry not found.", 404, "CASH_LOG_NOT_FOUND");
        }
        const incoming = row.direction === "INCOMING";
        if (incoming) {
            if (patch.receiptImageUrl !== undefined) {
                throw new AppError("Receipt image only applies to outgoing cash entries.", 400, "CASH_LOG_RECEIPT_NOT_ALLOWED");
            }
            if (patch.department !== undefined) {
                throw new AppError("Department only applies to outgoing cash entries.", 400, "CASH_LOG_DEPARTMENT_NOT_ALLOWED");
            }
        }
        else {
            if (patch.payeeCompany !== undefined || patch.invoiceNumber !== undefined) {
                throw new AppError("Payee company and invoice number only apply to incoming cash entries.", 400, "CASH_LOG_INCOMING_FIELDS_NOT_ALLOWED");
            }
        }
        if (!incoming && patch.receiptImageUrl !== undefined) {
            const oldR = row.receiptImageUrl;
            const newR = patch.receiptImageUrl;
            if (oldR && oldR !== newR) {
                await removeStoredUpload(oldR);
            }
        }
        const data: Record<string, unknown> = {};
        if (patch.amount !== undefined)
            data.amount = patch.amount;
        if (patch.memo !== undefined)
            data.memo = patch.memo;
        if (incoming) {
            if (patch.payeeCompany !== undefined)
                data.payeeCompany = patch.payeeCompany ? String(patch.payeeCompany).trim() || null : null;
            if (patch.invoiceNumber !== undefined)
                data.invoiceNumber = patch.invoiceNumber ? String(patch.invoiceNumber).trim() || null : null;
            if (patch.entryDate !== undefined)
                data.entryDate = patch.entryDate;
        }
        else {
            if (patch.department !== undefined)
                data.department = patch.department;
            if (patch.entryDate !== undefined)
                data.entryDate = patch.entryDate;
            if (patch.receiptImageUrl !== undefined)
                data.receiptImageUrl = patch.receiptImageUrl ? String(patch.receiptImageUrl).trim() || null : null;
        }
        const updated = await prisma.cashLogEntry.update({
            where: {
                id: row.id
            },
            data: data as Prisma.CashLogEntryUpdateInput,
            select: {
                id: true,
                companyId: true,
                createdByUserId: true,
                direction: true,
                amount: true,
                payeeCompany: true,
                invoiceNumber: true,
                department: true,
                memo: true,
                entryDate: true,
                receiptImageUrl: true,
                createdAt: true,
                updatedAt: true
            }
        });
        void logDatabaseActivity({
            companyId,
            feature: "cash_log_entry_update",
            dbWrites: 1,
            rowsWritten: 1,
            queryCount: 1,
            metadata: { table: "cash_log_entry", op: "update" },
        });
        return updated;
    }
    async list(companyId: string, take = 100, opts?: {
        from?: string;
        to?: string;
        direction?: "INCOMING" | "OUTGOING";
    }) {
        const range = buildUtcDayRange(opts);
        const rows = await prisma.cashLogEntry.findMany({
            where: {
                companyId,
                ...(opts?.direction ? { direction: opts.direction } : {}),
                ...(range ? whereEntryDateOrLegacyCreated(range) : {})
            },
            orderBy: { createdAt: "desc" },
            take: Math.min(Math.max(take, 1), 500),
            select: {
                id: true,
                direction: true,
                amount: true,
                payeeCompany: true,
                invoiceNumber: true,
                department: true,
                memo: true,
                entryDate: true,
                receiptImageUrl: true,
                createdAt: true,
                updatedAt: true,
                leaflinkPostedPayments: true,
                leaflinkPaymentSyncStatus: true,
                leaflinkPaymentSyncError: true,
            }
        });
        void logDatabaseActivity({
            companyId,
            feature: "cash_log_entry_list",
            dbReads: 1,
            rowsRead: rows.length,
            queryCount: 1,
            metadata: { table: "cash_log_entry", op: "list" },
        });
        const storedScan = await findRecentLeafLinkStoredOrdersForCompany(companyId, 4000);
        return rows.map((r) => ({
            ...r,
            leafLinkInvoiceStatus:
                r.direction === "INCOMING"
                    ? summarizeLeafLinkInvoiceFromStoredRows(storedScan, {
                          invoiceNumber: r.invoiceNumber,
                          payerName: r.payeeCompany,
                          amount: typeof r.amount === "number" ? r.amount : null,
                      })
                    : null,
        }));
    }
    /**
     * Digest / automation: rolling window `[from, to]` (inclusive UTC instants).
     * Uses **entry date** when set (same as export / admin list); legacy rows without `entryDate` use `createdAt`.
     */
    async listByCreatedAtRange(companyId: string, from: Date, to: Date) {
        if (!(from instanceof Date) || !(to instanceof Date) || from > to) {
            throw new AppError("Invalid datetime range for cash log query.", 400, "CASH_LOG_RANGE_INVALID");
        }
        return prisma.cashLogEntry.findMany({
            where: {
                companyId,
                ...whereEntryDateOrLegacyCreated({ gte: from, lte: to }),
            },
            orderBy: { createdAt: "desc" },
            take: 2000,
            select: {
                id: true,
                direction: true,
                amount: true,
                payeeCompany: true,
                invoiceNumber: true,
                department: true,
                memo: true,
                entryDate: true,
                receiptImageUrl: true,
                createdAt: true,
                leaflinkPaymentSyncStatus: true,
                leaflinkPaymentSyncError: true,
            },
        });
    }

    async listForExport(companyId: string, opts: { from: string; to: string; direction?: "INCOMING" | "OUTGOING" }) {
        const range = buildUtcDayRange(opts);
        if (!range) {
            throw new AppError("Export requires `from` and `to` query parameters (YYYY-MM-DD)", 400, "CASH_LOG_EXPORT_RANGE_REQUIRED");
        }
        return prisma.cashLogEntry.findMany({
            where: {
                companyId,
                ...(opts.direction ? { direction: opts.direction } : {}),
                ...whereEntryDateOrLegacyCreated(range)
            },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                direction: true,
                amount: true,
                payeeCompany: true,
                invoiceNumber: true,
                department: true,
                memo: true,
                entryDate: true,
                receiptImageUrl: true,
                createdAt: true
            }
        });
    }
    rowsToCsv(rows: Array<{
        id: string;
        direction: string;
        amount: number;
        payeeCompany: string | null;
        invoiceNumber: string | null;
        department: string | null;
        memo: string | null;
        entryDate: Date | null;
        createdAt: Date;
        receiptImageUrl: string | null;
    }>) {
        const header = [
            "id",
            "createdAt",
            "entryDate",
            "direction",
            "amount",
            "payeeCompany",
            "invoiceNumber",
            "department",
            "memo",
            "receiptImageUrl"
        ];
        const lines = [header.join(",")];
        for (const r of rows) {
            lines.push([
                csvEscape(r.id),
                csvEscape(r.createdAt?.toISOString?.() ?? r.createdAt),
                csvEscape(r.entryDate?.toISOString?.() ?? r.entryDate ?? ""),
                csvEscape(r.direction),
                csvEscape(r.amount),
                csvEscape(r.payeeCompany),
                csvEscape(r.invoiceNumber),
                csvEscape(r.department),
                csvEscape(r.memo),
                csvEscape(r.receiptImageUrl)
            ].join(","));
        }
        return lines.join("\r\n");
    }

    async deleteById(companyId: string, id: string) {
        const row = await prisma.cashLogEntry.findFirst({
            where: { id, companyId },
            select: { id: true, receiptImageUrl: true }
        });
        if (!row) {
            throw new AppError("Cash log entry not found.", 404, "CASH_LOG_NOT_FOUND");
        }
        await removeStoredUpload(row.receiptImageUrl);
        await prisma.cashLogEntry.delete({ where: { id: row.id } });
    }

    async matchLeafLinkIncoming(
        companyId: string,
        entryId: string,
        input: { refreshIfNoMatch?: boolean },
    ) {
        const entry = await prisma.cashLogEntry.findFirst({
            where: { id: entryId, companyId },
            select: {
                id: true,
                direction: true,
                amount: true,
                payeeCompany: true,
                invoiceNumber: true,
            },
        });
        if (!entry || entry.direction !== "INCOMING") {
            throw new AppError("Only incoming entries with optional invoice refs can match LeafLink orders.", 400, "CASH_LOG_LEAF_BAD_ENTRY");
        }
        const refresh = Boolean(input?.refreshIfNoMatch);
        const matchInput = {
            invoiceNumber: entry.invoiceNumber ?? undefined,
            payerName: entry.payeeCompany ?? undefined,
            amount: typeof entry.amount === "number" ? entry.amount : undefined,
        };
        let linkedOrders = await this.leafLinkOrdersService.findPaymentMatchCandidatesIncludingPaidForCheck(
            companyId,
            matchInput,
        );
        if (!linkedOrders.length && refresh) {
            linkedOrders = await this.leafLinkOrdersService.findPaymentMatchCandidatesIncludingPaidForCheck(
                companyId,
                matchInput,
            );
        }
        const candidates = linkedOrders.filter((c) => !c.markedPaidInLeafLink);
        const strongInvoice = (c: LeafLinkPaymentMatchCandidateDto) =>
            c.matchedBy.includes("invoice_exact") || c.matchedBy.includes("invoice_last4");
        const exactMatches = candidates.filter((c) => strongInvoice(c));
        const payeeNeedle = String(entry.payeeCompany || "").trim().toLowerCase();
        const entryAmt = typeof entry.amount === "number" ? entry.amount : null;
        const hasInvoiceTokens = Boolean(String(entry.invoiceNumber || "").trim());
        const possibleMatches = candidates.filter((c) => {
            if (exactMatches.some((x) => x.orderNumber === c.orderNumber))
                return false;
            const openish = String(c.paymentStatus || "").toLowerCase() !== "paid";
            if (!openish)
                return false;
            const nameOk = payeeNeedle ? String(c.customerName || "").toLowerCase().includes(payeeNeedle) : false;
            const amountOk =
                entryAmt == null
                    ? false
                    : sameMoneyCash(c.total, entryAmt) || sameMoneyCash(c.outstandingBalance ?? c.total, entryAmt);
            const invoicePartial = hasInvoiceTokens ? c.matchedBy.includes("invoice_partial") : false;
            return Boolean(invoicePartial || (nameOk && amountOk));
        });
        if (exactMatches.length === 1) {
            const chosen = exactMatches[0];
            await prisma.cashLogEntry.update({
                where: { id: entry.id },
                data: {
                    leaflinkPaymentSyncStatus: "matched",
                    leaflinkPaymentSyncError: null,
                },
            });
        }
        return {
            cashEntryId: entry.id,
            loggedPaymentAmount: entryAmt,
            exactMatches,
            possibleMatches,
            linkedOrders,
        };
    }

    async markLeafLinkIncomingPaid(
        companyId: string,
        actorUserId: string,
        entryId: string,
        input: {
            orderId?: string;
            orderNumber?: string;
            allowAmountOverride?: boolean;
            paymentAmount?: number;
            overrideNote?: string;
        },
    ) {
        const entry = await prisma.cashLogEntry.findFirst({
            where: { id: entryId, companyId },
            select: {
                id: true,
                direction: true,
                amount: true,
                payeeCompany: true,
                invoiceNumber: true,
                entryDate: true,
                leaflinkPostedPayments: true,
            },
        });
        if (!entry || entry.direction !== "INCOMING") {
            throw new AppError("Only incoming cash entries can post LeafLink payments.", 400, "CASH_LOG_LEAF_BAD_ENTRY");
        }
        const postedBefore = parsePostedPaymentsJson(entry.leaflinkPostedPayments);
        const cashAmt = typeof entry.amount === "number" ? entry.amount : NaN;
        if (!Number.isFinite(cashAmt) || cashAmt <= 0) {
            throw new AppError("Cash entry amount is required before posting payment.", 400, "CASH_AMOUNT_REQUIRED");
        }
        const candidates = await this.leafLinkOrdersService.findOpenPaymentCandidatesForCheck(companyId, {
            invoiceNumber: entry.invoiceNumber ?? undefined,
            payerName: entry.payeeCompany ?? undefined,
            amount: cashAmt,
        });
        const selected = candidates.find(
            (c) => c.orderNumber === input.orderNumber || c.orderId === input.orderId || c.leafLinkKey === input.orderId,
        );
        if (!selected) {
            throw new AppError("Selected LeafLink order was not found or is not open.", 404, "LEAFLINK_ORDER_NOT_OPEN");
        }
        if (hasPostedOrderNumber(postedBefore, selected.orderNumber)) {
            throw new AppError("A LeafLink payment for this order was already posted from this cash entry.", 409, "CASH_LEAF_DUPLICATE_ORDER");
        }
        const expectedBalance = selected.outstandingBalance ?? selected.total;
        const payAmtRaw =
            typeof input.paymentAmount === "number" && Number.isFinite(input.paymentAmount)
                ? input.paymentAmount
                : cashAmt;
        const payAmt = typeof payAmtRaw === "number" && Number.isFinite(payAmtRaw) ? payAmtRaw : NaN;
        if (!Number.isFinite(payAmt) || payAmt <= 0) {
            throw new AppError("Payment amount is invalid.", 400, "CASH_PAYMENT_AMOUNT_INVALID");
        }
        const amountMatches =
            sameMoneyCash(expectedBalance, payAmt) || sameMoneyCash(selected.total, payAmt);
        if (!amountMatches && !input.allowAmountOverride) {
            throw new AppError("Payment amount does not match invoice balance.", 409, "CASH_AMOUNT_MISMATCH");
        }
        if (!amountMatches && input.allowAmountOverride) {
            const overrideNote = String(input.overrideNote || "").trim();
            if (overrideNote.length < 3) {
                throw new AppError(
                    "Explain why the payment amount differs from the invoice balance.",
                    400,
                    "CASH_OVERRIDE_NOTE_REQUIRED",
                );
            }
        }
        const paymentDateIso = entry.entryDate
            ? new Date(entry.entryDate).toISOString().slice(0, 10)
            : new Date().toISOString().slice(0, 10);
        const paymentNote = buildLeafLinkCpuPaymentNote(
            `CPU cash log ${entry.id}`,
            !amountMatches,
            input.overrideNote,
        );
        try {
            const posted = await this.leafLinkOrdersService.postOrderPayment(companyId, {
                orderNumber: selected.orderNumber,
                leafLinkOrderId: selected.orderId,
                amount: payAmt,
                paymentDateIso,
                reference: entry.invoiceNumber ?? null,
                note: paymentNote,
                paymentMethod: "Cash",
            });
            const row: LeafLinkPostedPaymentRow = {
                orderNumber: selected.orderNumber,
                paymentId: posted.paymentId,
                amount: payAmt,
                postedAt: new Date().toISOString(),
            };
            const mergedJson = [...postedBefore, row];
            await prisma.cashLogEntry.update({
                where: { id: entry.id },
                data: {
                    leaflinkPostedPayments: mergedJson as Prisma.InputJsonValue,
                    leaflinkPaymentSyncStatus: "payment_posted",
                    leaflinkPaymentSyncError: null,
                },
            });
            await this.auditService.logAction({
                companyId,
                actorUserId,
                action: "cash_log_leaflink_payment_posted",
                entityType: "CashLogEntry",
                entityId: entry.id,
                before: { entryId: entry.id },
                after: {
                    orderNumber: selected.orderNumber,
                    loggedAmount: cashAmt,
                    paymentAmount: payAmt,
                    invoiceBalance: expectedBalance,
                    amountMatches,
                    overrideNote: amountMatches ? null : String(input.overrideNote || "").trim() || null,
                    paymentId: posted.paymentId,
                    result: posted.paymentStatus,
                },
            });
            return {
                ok: true,
                paymentId: posted.paymentId,
                paymentStatus: posted.paymentStatus,
                orderNumber: selected.orderNumber,
            };
        }
        catch (err) {
            await prisma.cashLogEntry.update({
                where: { id: entry.id },
                data: {
                    leaflinkPaymentSyncStatus: "failed",
                    leaflinkPaymentSyncError: err instanceof Error ? err.message : String(err),
                },
            });
            throw err;
        }
    }
}
