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
export class CheckCaptureService {
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
                rawOcrJson: input.rawOcrJson ? JSON.stringify(input.rawOcrJson) : undefined
            }
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
                invoiceNumber: true
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
        return prisma.checkCapture.update({
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
                createdAt: true,
                updatedAt: true
            }
        });
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
        return prisma.checkCapture.findMany({
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
                createdAt: true,
                updatedAt: true
            }
        });
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
    }
}
