import { prisma } from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
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
function buildCreatedAtFilter(opts: { from?: string; to?: string } | undefined) {
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
function csvEscape(value: unknown) {
    const s = value == null ? "" : String(value);
    if (/[",\r\n]/.test(s))
        return `"${s.replace(/"/g, '""')}"`;
    return s;
}
export class CashLogService {
    async create(input: {
        companyId: string;
        createdByUserId: string;
        direction: "INCOMING" | "OUTGOING";
        amount: number;
        memo?: string | null;
        entryDate?: Date | null;
    }) {
        return prisma.cashLogEntry.create({
            data: {
                companyId: input.companyId,
                createdByUserId: input.createdByUserId,
                direction: input.direction,
                amount: input.amount,
                memo: input.memo ?? undefined,
                entryDate: input.entryDate ?? undefined
            },
            select: {
                id: true,
                companyId: true,
                createdByUserId: true,
                direction: true,
                amount: true,
                memo: true,
                entryDate: true,
                createdAt: true,
                updatedAt: true
            }
        });
    }
    async list(companyId: string, take = 100, opts?: { from?: string; to?: string }) {
        const createdAt = buildCreatedAtFilter(opts);
        return prisma.cashLogEntry.findMany({
            where: {
                companyId,
                ...(createdAt ? { createdAt } : {})
            },
            orderBy: { createdAt: "desc" },
            take: Math.min(Math.max(take, 1), 500),
            select: {
                id: true,
                direction: true,
                amount: true,
                memo: true,
                entryDate: true,
                createdAt: true,
                updatedAt: true
            }
        });
    }
    async listForExport(companyId: string, opts: { from: string; to: string }) {
        const createdAt = buildCreatedAtFilter(opts);
        if (!createdAt) {
            throw new AppError("Export requires `from` and `to` query parameters (YYYY-MM-DD)", 400, "CASH_LOG_EXPORT_RANGE_REQUIRED");
        }
        return prisma.cashLogEntry.findMany({
            where: { companyId, createdAt },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                direction: true,
                amount: true,
                memo: true,
                entryDate: true,
                createdAt: true
            }
        });
    }
    rowsToCsv(rows: Array<{
        id: string;
        direction: string;
        amount: number;
        memo: string | null;
        entryDate: Date | null;
        createdAt: Date;
    }>) {
        const header = ["id", "createdAt", "entryDate", "direction", "amount", "memo"];
        const lines = [header.join(",")];
        for (const r of rows) {
            lines.push([
                csvEscape(r.id),
                csvEscape(r.createdAt?.toISOString?.() ?? r.createdAt),
                csvEscape(r.entryDate?.toISOString?.() ?? r.entryDate ?? ""),
                csvEscape(r.direction),
                csvEscape(r.amount),
                csvEscape(r.memo)
            ].join(","));
        }
        return lines.join("\r\n");
    }
}
