import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import type { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";
import { objectKeyFromParts, putUploadObject, removeStoredUpload, uploadsUseS3 } from "../lib/uploadStorage.js";

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
export class CashLogService {
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
        return prisma.cashLogEntry.create({
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
    }
    async list(companyId: string, take = 100, opts?: {
        from?: string;
        to?: string;
        direction?: "INCOMING" | "OUTGOING";
    }) {
        const range = buildUtcDayRange(opts);
        return prisma.cashLogEntry.findMany({
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
                updatedAt: true
            }
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
}
