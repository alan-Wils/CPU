import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
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
import { AuditService } from "./auditService.js";
import {
    hasPostedOrderNumber,
    mergePostedPaymentsFromCheckCapture,
    parsePostedPaymentsJson,
    type LeafLinkPostedPaymentRow
} from "../lib/leaflinkPostedPayments.js";
import { findRecentLeafLinkStoredOrdersForCompany } from "./leafLinkOrdersStorePrimitives.js";
import {
    LeafLinkOrdersService,
    type LeafLinkPaymentMatchCandidateDto,
    summarizeLeafLinkInvoiceFromStoredRows,
} from "./leafLinkOrdersService.js";

function extForMime(mimeType) {
    if (mimeType === "image/png")
        return "png";
    if (mimeType === "image/webp")
        return "webp";
    return "jpg";
}
const MONTH_NAME = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i;
const MONTH_MAP = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12"
};
/** Prefer largest plausible amount; OCR often emits a small false positive before the real total. */
function extractPrimaryCheckAmount(raw) {
    const text = String(raw || "").replace(/\r/g, "");
    const candidates = [];
    const pushAmount = (intPart, cents) => {
        const left = String(intPart || "").replace(/,/g, "");
        if (!/^\d+$/.test(left))
            return;
        if (!/^\d{2}$/.test(cents))
            return;
        const n = Number(`${left}.${cents}`);
        if (!Number.isFinite(n) || n < 0.01 || n > 99_000_000)
            return;
        candidates.push(n);
    };
    const dollarRe = /\$\s*([\d,]+)\.(\d{2})\b/g;
    let m;
    while ((m = dollarRe.exec(text)) !== null) {
        pushAmount(m[1], m[2]);
    }
    const commaGroupRe = /\b([\d]{1,3}(?:,[\d]{3})+)\.(\d{2})\b/g;
    while ((m = commaGroupRe.exec(text)) !== null) {
        pushAmount(m[1], m[2]);
    }
    const wideIntRe = /\b(\d{4,})\.(\d{2})\b/g;
    while ((m = wideIntRe.exec(text)) !== null) {
        pushAmount(m[1], m[2]);
    }
    if (!candidates.length)
        return undefined;
    return Math.max(...candidates);
}
function parseCheckText(text) {
    const raw = String(text || "").replace(/\r/g, "");
    const lines = raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    const amount = extractPrimaryCheckAmount(raw);
    let payerName;
    const payeeBlock = raw.match(/PAY\s+TO\s+THE\s+ORDER\s+OF\s*\n?\s*(.+?)(?:\n{2,}|$)/is);
    if (payeeBlock) {
        payerName = payeeBlock[1]
            .split("\n")[0]
            ?.trim()
            .replace(/\s+/g, " ")
            .slice(0, 200);
    }
    if (!payerName) {
        const payee2 = raw.match(/PAY\s+TO\s+THE\s+ORDER\s+OF\s+(.+)/i);
        if (payee2)
            payerName = payee2[1].trim().replace(/\s+/g, " ").slice(0, 200);
    }
    let checkNumber;
    const cn1 = raw.match(/(?:CHECK|CHK)\s*#?\s*[:]?\s*(\d{2,12})/i);
    const cn2 = raw.match(/\bNo\.?\s*#?\s*(\d{2,12})\b/i);
    if (cn1)
        checkNumber = cn1[1];
    else if (cn2)
        checkNumber = cn2[1];
    let checkDate;
    const d1 = raw.match(/\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])[\/\-](\d{2,4})\b/);
    if (d1) {
        const [mm, dd, yyyy] = [d1[1], d1[2], d1[3]];
        const year = yyyy.length === 2 ? `20${yyyy}` : yyyy;
        checkDate = `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    }
    else {
        const d2 = raw.match(MONTH_NAME);
        if (d2) {
            const mon = MONTH_MAP[d2[1].toLowerCase()];
            if (mon)
                checkDate = `${d2[3]}-${mon}-${d2[2].padStart(2, "0")}`;
        }
    }
    let routingNumber;
    let accountNumber;
    const micr = raw.replace(/\s+/g, " ").match(/(\d{9})\D+(\d{4,17})\D+(\d{2,10})\b/);
    if (micr) {
        routingNumber = micr[1];
        accountNumber = micr[2];
        if (!checkNumber)
            checkNumber = micr[3];
    }
    else {
        const rt = raw.match(/\b(\d{9})\b/);
        if (rt)
            routingNumber = rt[1];
        const accts = raw.match(/\b(\d{10,17})\b/g);
        if (accts) {
            accountNumber = accts.find((a) => a !== routingNumber);
        }
    }
    const memoLine = lines.find((line) => /^memo[:\s]/i.test(line)) || "";
    let memo = memoLine ? memoLine.replace(/^memo[:\s]*/i, "").trim() : undefined;
    if (!memo) {
        const memoLabelIdx = lines.findIndex((line) => /^memo[:\s]*$/i.test(line));
        if (memoLabelIdx >= 0) {
            memo = String(lines[memoLabelIdx + 1] || "").trim() || undefined;
        }
    }
    if (!memo) {
        memo =
            lines.find((line) => /\b\d{3,}\s+[A-Z]{1,4}\s+\d{3,}\b/i.test(line) && line.length <= 60) || undefined;
    }
    const bankName = lines.find((line) => /(bank|credit union|financial|N\.A\.|N\.A\b)/i.test(line) && line.length <= 120) ||
        undefined;
    if (!payerName) {
        payerName =
            lines.find((line) => /(llc|inc|corp|company|healthcare|holdings|enterprises|group|services)/i.test(line) &&
                !/(bank|credit union|financial)/i.test(line) &&
                line.length <= 200) || undefined;
    }
    return {
        checkDate,
        amount,
        checkNumber,
        payerName,
        routingNumber,
        accountNumber,
        bankName,
        memo
    };
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function parseUtcDayStart(isoDate) {
    if (!ISO_DATE.test(String(isoDate || "").trim()))
        return undefined;
    const [y, m, d] = String(isoDate).split("-").map((n) => Number(n));
    if (!y || !m || !d)
        return undefined;
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}
function parseUtcDayEnd(isoDate) {
    if (!ISO_DATE.test(String(isoDate || "").trim()))
        return undefined;
    const [y, m, d] = String(isoDate).split("-").map((n) => Number(n));
    if (!y || !m || !d)
        return undefined;
    return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
}
function csvEscape(value) {
    const s = value == null ? "" : String(value);
    if (/[",\r\n]/.test(s))
        return `"${s.replace(/"/g, '""')}"`;
    return s;
}
const AMOUNT_TOLERANCE = 0.01;
function normalizeText(v) {
    return String(v || "").trim().toLowerCase();
}
function sameMoney(a, b) {
    return Math.abs(Number(a || 0) - Number(b || 0)) <= AMOUNT_TOLERANCE;
}
export type CheckLeafLinkMatchResult = {
    checkId: string;
    exactMatches: LeafLinkPaymentMatchCandidateDto[];
    possibleMatches: LeafLinkPaymentMatchCandidateDto[];
    /** All invoice-related matches from synced orders, including already-paid (for UI status). */
    linkedOrders: LeafLinkPaymentMatchCandidateDto[];
};
export class CheckCaptureService {
    leafLinkOrdersService = new LeafLinkOrdersService();
    auditService = new AuditService();
    async uploadImage(input) {
        const base64 = String(input.dataBase64 || "").replace(/^data:[^;]+;base64,/, "");
        const buffer = Buffer.from(base64, "base64");
        if (!buffer.length) {
            throw new AppError("Invalid check image data", 400, "CHECK_IMAGE_INVALID");
        }
        if (buffer.length > env.CHECK_UPLOAD_MAX_BYTES) {
            throw new AppError(`Image exceeds ${env.CHECK_UPLOAD_MAX_BYTES} byte limit`, 413, "CHECK_IMAGE_TOO_LARGE");
        }
        requirePersistentUploadsInProduction();
        const ext = extForMime(input.mimeType);
        const safeName = `${Date.now()}-${randomUUID().slice(0, 12)}.${ext}`;
        if (uploadsUseS3()) {
            const key = objectKeyFromParts("checks", input.companyId, safeName);
            const mime = input.mimeType === "image/png" ? "image/png" : input.mimeType === "image/webp" ? "image/webp" : "image/jpeg";
            await putUploadObject(key, buffer, mime);
            void recordUsageEventSafe({
                companyId: input.companyId,
                provider: "cloudflare_r2",
                feature: "check_image_upload",
                unitType: "upload_bytes",
                units: buffer.length,
                estimatedCost: Math.max(0.0005, (buffer.length / (1024 * 1024)) * 0.02),
            });
            return {
                imageUrl: `${input.origin}/uploads/checks/${input.companyId}/${safeName}`,
                bytes: buffer.length
            };
        }
        const directory = path.join(process.cwd(), "uploads", "checks", input.companyId);
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, safeName), buffer);
        return {
            imageUrl: `${input.origin}/uploads/checks/${input.companyId}/${safeName}`,
            bytes: buffer.length
        };
    }
    async extractFields(input) {
        const apiKey = String(env.OCR_SPACE_API_KEY || "").trim();
        if (!apiKey) {
            return {
                provider: "manual-review",
                parsed: {
                    checkDate: undefined,
                    amount: undefined,
                    checkNumber: undefined,
                    payerName: undefined,
                    routingNumber: undefined,
                    accountNumber: undefined,
                    bankName: undefined,
                    memo: undefined
                },
                raw: { reason: "OCR_SPACE_API_KEY not configured" }
            };
        }
        const body = new URLSearchParams();
        body.set("apikey", apiKey);
        body.set("language", "eng");
        body.set("isOverlayRequired", "false");
        body.set("OCREngine", "2");
        if (input.imageUrl)
            body.set("url", input.imageUrl);
        if (input.dataBase64 && input.mimeType) {
            body.set("base64Image", `data:${input.mimeType};base64,${input.dataBase64.replace(/^data:[^;]+;base64,/, "")}`);
        }
        const response = await fetch("https://api.ocr.space/parse/image", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString()
        });
        if (!response.ok) {
            throw new AppError("OCR provider request failed", 502, "CHECK_OCR_PROVIDER_ERROR");
        }
        const payload = (await response.json());
        const providerErrored = Boolean(payload?.IsErroredOnProcessing);
        const hasResults = Array.isArray(payload?.ParsedResults) && payload.ParsedResults.length > 0;
        if (providerErrored || !hasResults) {
            return {
                provider: "ocr-space-no-fields",
                parsed: {
                    checkDate: undefined,
                    amount: undefined,
                    checkNumber: undefined,
                    payerName: undefined,
                    routingNumber: undefined,
                    accountNumber: undefined,
                    bankName: undefined,
                    memo: undefined
                },
                raw: payload
            };
        }
        const parsedText = String(payload?.ParsedResults?.[0]?.ParsedText || "");
        const parsed = parseCheckText(parsedText);
        return {
            provider: "ocr-space",
            parsed,
            raw: payload
        };
    }
    async saveCheck(input) {
        const row = await prisma.checkCapture.create({
            data: {
                companyId: input.companyId,
                createdByUserId: input.createdByUserId,
                checkDate: input.checkDate,
                amount: input.amount,
                checkNumber: input.checkNumber,
                payerName: input.payerName,
                routingNumber: input.routingNumber,
                accountNumber: input.accountNumber,
                bankName: input.bankName,
                memo: input.memo,
                invoiceNumber: input.invoiceNumber,
                imageUrl: input.imageUrl,
                stubImageUrl: input.stubImageUrl,
                rawOcrJson: input.rawOcrJson ? JSON.stringify(input.rawOcrJson) : undefined,
                paymentSyncStatus: "not_matched"
            }
        });
        void logDatabaseActivity({
            companyId: input.companyId,
            feature: "check_capture_save",
            dbWrites: 1,
            rowsWritten: 1,
            queryCount: 1,
            metadata: { table: "check_capture", op: "insert" },
        });
        return row;
    }
    async updateById(companyId, id, patch) {
        const row = await prisma.checkCapture.findFirst({
            where: {
                id,
                companyId
            },
            select: {
                id: true,
                imageUrl: true,
                stubImageUrl: true,
                checkDate: true,
                amount: true,
                checkNumber: true,
                payerName: true,
                routingNumber: true,
                accountNumber: true,
                bankName: true,
                memo: true,
                invoiceNumber: true,
                leaflinkOrderId: true,
                leaflinkOrderNumber: true,
                leaflinkPaymentId: true,
                leaflinkPaymentStatus: true,
                leaflinkMatchedAt: true,
                leaflinkPaidAt: true,
                paymentSyncStatus: true,
                paymentSyncError: true
            }
        });
        if (!row) {
            throw new AppError("Check capture not found.", 404, "CHECK_CAPTURE_NOT_FOUND");
        }
        if (patch.imageUrl !== undefined && patch.imageUrl !== row.imageUrl) {
            await removeStoredUpload(row.imageUrl);
        }
        if (patch.stubImageUrl !== undefined) {
            const oldStub = row.stubImageUrl;
            const newStub = patch.stubImageUrl;
            if (oldStub && oldStub !== newStub) {
                await removeStoredUpload(oldStub);
            }
        }
        const data: Prisma.CheckCaptureUncheckedUpdateInput = {};
        if (patch.checkDate !== undefined)
            data.checkDate = patch.checkDate;
        if (patch.amount !== undefined)
            data.amount = patch.amount;
        if (patch.checkNumber !== undefined)
            data.checkNumber = patch.checkNumber;
        if (patch.payerName !== undefined)
            data.payerName = patch.payerName;
        if (patch.routingNumber !== undefined)
            data.routingNumber = patch.routingNumber;
        if (patch.accountNumber !== undefined)
            data.accountNumber = patch.accountNumber;
        if (patch.bankName !== undefined)
            data.bankName = patch.bankName;
        if (patch.memo !== undefined)
            data.memo = patch.memo;
        if (patch.invoiceNumber !== undefined)
            data.invoiceNumber = patch.invoiceNumber;
        if (patch.imageUrl !== undefined)
            data.imageUrl = patch.imageUrl;
        if (patch.stubImageUrl !== undefined)
            data.stubImageUrl = patch.stubImageUrl;
        if (patch.rawOcrJson !== undefined) {
            data.rawOcrJson = patch.rawOcrJson == null ? null : JSON.stringify(patch.rawOcrJson);
        }
        const updated = await prisma.checkCapture.update({
            where: {
                id: row.id
            },
            data,
            select: {
                id: true,
                companyId: true,
                createdByUserId: true,
                checkDate: true,
                amount: true,
                checkNumber: true,
                payerName: true,
                routingNumber: true,
                accountNumber: true,
                bankName: true,
                memo: true,
                invoiceNumber: true,
                imageUrl: true,
                stubImageUrl: true,
                leaflinkOrderId: true,
                leaflinkOrderNumber: true,
                leaflinkPaymentId: true,
                leaflinkPaymentStatus: true,
                leaflinkMatchedAt: true,
                leaflinkPaidAt: true,
                paymentSyncStatus: true,
                paymentSyncError: true,
                createdAt: true,
                updatedAt: true
            }
        });
        void logDatabaseActivity({
            companyId,
            feature: "check_capture_update",
            dbWrites: 1,
            rowsWritten: 1,
            queryCount: 1,
            metadata: { table: "check_capture", op: "update" },
        });
        return updated;
    }
    async matchLeafLinkInvoice(companyId, checkId, input) {
        const check = await prisma.checkCapture.findFirst({
            where: { id: checkId, companyId },
            select: {
                id: true,
                amount: true,
                payerName: true,
                invoiceNumber: true,
                leaflinkPaymentId: true
            }
        });
        if (!check) {
            throw new AppError("Check capture not found.", 404, "CHECK_CAPTURE_NOT_FOUND");
        }
        const refresh = Boolean(input?.refreshIfNoMatch);
        const matchInput = {
            invoiceNumber: check.invoiceNumber ?? undefined,
            payerName: check.payerName ?? undefined,
            amount: typeof check.amount === "number" ? check.amount : undefined
        };
        let linkedOrders = await this.leafLinkOrdersService.findPaymentMatchCandidatesIncludingPaidForCheck(companyId, matchInput);
        if (!linkedOrders.length && refresh) {
            await this.leafLinkOrdersService.syncOrdersWarm(companyId);
            linkedOrders = await this.leafLinkOrdersService.findPaymentMatchCandidatesIncludingPaidForCheck(companyId, matchInput);
        }
        const candidates = linkedOrders.filter((c) => !c.markedPaidInLeafLink);
        const hasInvoiceTokens = Boolean(normalizeText(check.invoiceNumber));
        const payeeNeedle = normalizeText(check.payerName);
        const checkAmount = typeof check.amount === "number" ? check.amount : null;
        const strongInvoice = (c: LeafLinkPaymentMatchCandidateDto) =>
            c.matchedBy.includes("invoice_exact") || c.matchedBy.includes("invoice_last4");
        const exactMatches = candidates.filter((c) => strongInvoice(c));
        const possibleMatches = candidates.filter((c) => {
            if (exactMatches.find((x) => x.orderNumber === c.orderNumber))
                return false;
            const openish = normalizeText(c.paymentStatus) !== "paid";
            if (!openish)
                return false;
            const nameOk = payeeNeedle ? normalizeText(c.customerName).includes(payeeNeedle) : false;
            const amountOk = checkAmount == null ? false : (sameMoney(c.total, checkAmount) || sameMoney(c.outstandingBalance, checkAmount));
            const invoicePartial = hasInvoiceTokens ? c.matchedBy.includes("invoice_partial") : false;
            return Boolean(invoicePartial || (nameOk && amountOk));
        });
        if (exactMatches.length === 1) {
            const chosen = exactMatches[0];
            await prisma.checkCapture.update({
                where: { id: check.id },
                data: {
                    leaflinkOrderId: chosen.orderId || chosen.leafLinkKey,
                    leaflinkOrderNumber: chosen.orderNumber,
                    leaflinkMatchedAt: new Date(),
                    paymentSyncStatus: "matched",
                    paymentSyncError: null
                }
            });
        }
        return {
            checkId: check.id,
            exactMatches,
            possibleMatches,
            linkedOrders
        };
    }
    async markLeafLinkInvoicePaid(companyId, actorUserId, checkId, input) {
        const check = await prisma.checkCapture.findFirst({
            where: { id: checkId, companyId },
            select: {
                id: true,
                checkDate: true,
                checkNumber: true,
                amount: true,
                payerName: true,
                invoiceNumber: true,
                leaflinkPaymentId: true,
                leaflinkOrderNumber: true,
                leaflinkPostedPayments: true,
            }
        });
        if (!check) {
            throw new AppError("Check capture not found.", 404, "CHECK_CAPTURE_NOT_FOUND");
        }
        const postedBefore = mergePostedPaymentsFromCheckCapture(check);
        const amount = typeof check.amount === "number" ? check.amount : NaN;
        if (!Number.isFinite(amount) || amount < 0) {
            throw new AppError("Check amount is required before posting payment.", 400, "CHECK_AMOUNT_REQUIRED");
        }
        const candidates = await this.leafLinkOrdersService.findOpenPaymentCandidatesForCheck(companyId, {
            invoiceNumber: check.invoiceNumber ?? undefined,
            payerName: check.payerName ?? undefined,
            amount
        });
        const selected = candidates.find((c) => c.orderNumber === input.orderNumber || c.orderId === input.orderId || c.leafLinkKey === input.orderId);
        if (!selected) {
            throw new AppError("Selected LeafLink order was not found or is not open.", 404, "LEAFLINK_ORDER_NOT_OPEN");
        }
        if (hasPostedOrderNumber(postedBefore, selected.orderNumber)) {
            throw new AppError("A LeafLink payment for this order was already posted from this check.", 409, "CHECK_LEAFLINK_DUPLICATE_ORDER");
        }
        const expectedBalance = selected.outstandingBalance ?? selected.total;
        const payAmtRaw = typeof input.paymentAmount === "number" && Number.isFinite(input.paymentAmount)
            ? input.paymentAmount
            : expectedBalance;
        const payAmt = typeof payAmtRaw === "number" && Number.isFinite(payAmtRaw) ? payAmtRaw : NaN;
        if (!Number.isFinite(payAmt) || payAmt <= 0) {
            throw new AppError("Payment amount is invalid.", 400, "CHECK_PAYMENT_AMOUNT_INVALID");
        }
        const amountMatches = sameMoney(expectedBalance, payAmt) || sameMoney(selected.total, payAmt);
        if (!amountMatches && !input.allowAmountOverride) {
            throw new AppError("Payment amount does not match invoice balance.", 409, "CHECK_AMOUNT_MISMATCH");
        }
        const paymentDateIso = check.checkDate ? new Date(check.checkDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
        try {
            const posted = await this.leafLinkOrdersService.postOrderPayment(companyId, {
                orderNumber: selected.orderNumber,
                leafLinkOrderId: selected.orderId,
                amount: payAmt,
                paymentDateIso,
                reference: check.checkNumber ?? check.invoiceNumber ?? null,
                note: `CPU check capture ${check.id}`,
                paymentMethod: "Check",
            });
            const row: LeafLinkPostedPaymentRow = {
                orderNumber: selected.orderNumber,
                paymentId: posted.paymentId,
                amount: payAmt,
                postedAt: new Date().toISOString(),
            };
            const mergedJson = [...parsePostedPaymentsJson(check.leaflinkPostedPayments), row];
            await prisma.checkCapture.update({
                where: { id: check.id },
                data: {
                    leaflinkOrderId: selected.orderId || selected.leafLinkKey,
                    leaflinkOrderNumber: selected.orderNumber,
                    leaflinkPaymentId: posted.paymentId,
                    leaflinkPaymentStatus: posted.paymentStatus,
                    leaflinkMatchedAt: new Date(),
                    leaflinkPaidAt: new Date(),
                    leaflinkPostedPayments: mergedJson as import("@prisma/client").Prisma.InputJsonValue,
                    leaflinkPaymentResponseJson: JSON.stringify(posted.rawResponse),
                    paymentSyncStatus: "payment_posted",
                    paymentSyncError: null
                }
            });
            await this.auditService.logAction({
                companyId,
                actorUserId,
                action: "check_capture_leaflink_payment_posted",
                entityType: "CheckCapture",
                entityId: check.id,
                before: {
                    checkId: check.id
                },
                after: {
                    orderNumber: selected.orderNumber,
                    amount,
                    paymentId: posted.paymentId,
                    result: posted.paymentStatus
                }
            });
            return {
                ok: true,
                paymentId: posted.paymentId,
                paymentStatus: posted.paymentStatus,
                orderNumber: selected.orderNumber
            };
        }
        catch (err) {
            await prisma.checkCapture.update({
                where: { id: check.id },
                data: {
                    leaflinkOrderId: selected.orderId || selected.leafLinkKey,
                    leaflinkOrderNumber: selected.orderNumber,
                    paymentSyncStatus: "failed",
                    paymentSyncError: err instanceof Error ? err.message : String(err),
                    leaflinkPaymentResponseJson: JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
                }
            });
            throw err;
        }
    }
    buildDateFilter(opts) {
        const from = opts?.from ? parseUtcDayStart(opts.from) : undefined;
        const to = opts?.to ? parseUtcDayEnd(opts.to) : undefined;
        if (!from && !to)
            return undefined;
        if (from && to && from > to) {
            throw new AppError("`from` date must be on or before `to` date", 400, "CHECK_DATE_RANGE_INVALID");
        }
        return {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {})
        };
    }
    /**
     * Digest / automation: rows whose `createdAt` falls in `[from, to]` (inclusive UTC instants).
     */
    async listByCreatedAtRange(companyId: string, from: Date, to: Date) {
        if (!(from instanceof Date) || !(to instanceof Date) || from > to) {
            throw new AppError("Invalid datetime range for check capture query.", 400, "CHECK_CAPTURE_RANGE_INVALID");
        }
        return prisma.checkCapture.findMany({
            where: {
                companyId,
                createdAt: { gte: from, lte: to },
            },
            orderBy: { createdAt: "desc" },
            take: 2000,
            select: {
                id: true,
                checkDate: true,
                amount: true,
                checkNumber: true,
                payerName: true,
                memo: true,
                invoiceNumber: true,
                imageUrl: true,
                stubImageUrl: true,
                createdAt: true,
            },
        });
    }
    async listChecks(companyId, take = 50, opts) {
        const createdAt = this.buildDateFilter(opts);
        const rows = await prisma.checkCapture.findMany({
            where: {
                companyId,
                ...(createdAt ? { createdAt } : {})
            },
            orderBy: { createdAt: "desc" },
            take: Math.min(Math.max(take, 1), 200),
            // Omit rawOcrJson: can be huge and is not needed for the recent-records list.
            select: {
                id: true,
                companyId: true,
                createdByUserId: true,
                checkDate: true,
                amount: true,
                checkNumber: true,
                payerName: true,
                routingNumber: true,
                accountNumber: true,
                bankName: true,
                memo: true,
                invoiceNumber: true,
                imageUrl: true,
                stubImageUrl: true,
                leaflinkOrderId: true,
                leaflinkOrderNumber: true,
                leaflinkPaymentId: true,
                leaflinkPaymentStatus: true,
                leaflinkMatchedAt: true,
                leaflinkPaidAt: true,
                paymentSyncStatus: true,
                paymentSyncError: true,
                createdAt: true,
                updatedAt: true
            }
        });
        void logDatabaseActivity({
            companyId,
            feature: "check_capture_list",
            dbReads: 1,
            rowsRead: rows.length,
            queryCount: 1,
            metadata: { table: "check_capture", op: "list" },
        });
        const storedScan = await findRecentLeafLinkStoredOrdersForCompany(companyId, 4000);
        return rows.map((r) => ({
            ...r,
            leafLinkInvoiceStatus: summarizeLeafLinkInvoiceFromStoredRows(storedScan, {
                invoiceNumber: r.invoiceNumber,
                payerName: r.payerName,
                amount: typeof r.amount === "number" ? r.amount : null,
            }),
        }));
    }
    async listChecksForExport(companyId, opts) {
        const createdAt = this.buildDateFilter(opts);
        if (!createdAt) {
            throw new AppError("Export requires `from` and `to` query parameters (YYYY-MM-DD)", 400, "CHECK_EXPORT_RANGE_REQUIRED");
        }
        return prisma.checkCapture.findMany({
            where: { companyId, createdAt },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                createdAt: true,
                checkDate: true,
                amount: true,
                checkNumber: true,
                payerName: true,
                memo: true,
                invoiceNumber: true,
                imageUrl: true,
                stubImageUrl: true
            }
        });
    }
    rowsToCsv(rows) {
        const header = [
            "id",
            "createdAt",
            "checkDate",
            "payee",
            "total",
            "checkNumber",
            "invoiceNumber",
            "memo",
            "imageUrl",
            "stubImageUrl"
        ];
        const lines = [header.join(",")];
        for (const r of rows) {
            lines.push([
                csvEscape(r.id),
                csvEscape(r.createdAt?.toISOString?.() ?? r.createdAt),
                csvEscape(r.checkDate?.toISOString?.() ?? r.checkDate ?? ""),
                csvEscape(r.payerName),
                csvEscape(r.amount == null ? "" : r.amount),
                csvEscape(r.checkNumber),
                csvEscape(r.invoiceNumber),
                csvEscape(r.memo),
                csvEscape(r.imageUrl),
                csvEscape(r.stubImageUrl)
            ].join(","));
        }
        return lines.join("\r\n");
    }

    async deleteById(companyId, id) {
        const row = await prisma.checkCapture.findFirst({
            where: { id, companyId },
            select: { id: true, imageUrl: true, stubImageUrl: true }
        });
        if (!row) {
            throw new AppError("Check capture not found.", 404, "CHECK_CAPTURE_NOT_FOUND");
        }
        await removeStoredUpload(row.imageUrl);
        await removeStoredUpload(row.stubImageUrl);
        await prisma.checkCapture.delete({ where: { id: row.id } });
        void logDatabaseActivity({
            companyId,
            feature: "check_capture_delete",
            dbWrites: 1,
            rowsWritten: 1,
            queryCount: 1,
            metadata: { table: "check_capture", op: "delete" },
        });
    }
}
