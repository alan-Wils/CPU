import { Router } from "express";
import { z } from "zod";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { requireRole } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import {
    cashLeafLinkMarkPaidSchema,
    cashLeafLinkMatchSchema,
    cashLogCreateSchema,
    cashLogUpdateSchema,
    checkUploadSchema,
} from "../../validation/schemas.js";
import { CashLogService } from "../../services/cashLogService.js";
import { AppError } from "../../errors/AppError.js";
import { logInfo } from "../../lib/logger.js";
import { prisma } from "../../config/prisma.js";
import {
    cashLogEodPrefsSchema,
    mergeCashLogEodPrefs,
    mergeScheduleIntoExistingMembershipPrefs,
} from "../../lib/cashLogEodPrefs.js";

const cashLogWriteRoles = ["OWNER", "ADMIN"];
const cashLogReadRoles = ["OWNER", "ADMIN", "OPERATIONS_MANAGER", "FINANCIAL_ANALYST"];
const cashLogLeafLinkRoles = ["OWNER", "ADMIN", "OPERATIONS_MANAGER"];
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const listQuerySchema = z.object({
    take: z.coerce.number().int().positive().max(500).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    direction: z.enum(["INCOMING", "OUTGOING"]).optional()
});
const exportQuerySchema = z.object({
    from: isoDate,
    to: isoDate,
    direction: z.enum(["INCOMING", "OUTGOING"]).optional()
});
const cashLogIdParam = z.object({ id: z.string().cuid() });

export const cashLogRouter = Router();
const service = new CashLogService();

cashLogRouter.get("/export", requireRole([...cashLogReadRoles]), validate({ query: exportQuerySchema }), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    if (!companyId) {
        throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
    }
    const from = String(req.query.from);
    const to = String(req.query.to);
    const direction = req.query.direction === "INCOMING" || req.query.direction === "OUTGOING"
        ? req.query.direction
        : undefined;
    const rows = await service.listForExport(companyId, { from, to, direction });
    const csv = service.rowsToCsv(rows);
    const safeFrom = from.replace(/[^\d-]/g, "");
    const safeTo = to.replace(/[^\d-]/g, "");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="cash-log-${safeFrom}_${safeTo}.csv"`);
    res.send(csv);
}));

cashLogRouter.get("/", requireRole([...cashLogReadRoles]), validate({ query: listQuerySchema }), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    if (!companyId) {
        throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
    }
    const take = Number(req.query?.take || 100);
    const from = typeof req.query?.from === "string" ? req.query.from : undefined;
    const to = typeof req.query?.to === "string" ? req.query.to : undefined;
    const direction = req.query.direction === "INCOMING" || req.query.direction === "OUTGOING"
        ? req.query.direction
        : undefined;
    const rows = await service.list(companyId, take, { from, to, direction });
    res.json({ rows });
}));

cashLogRouter.post("/upload-receipt", requireRole([...cashLogWriteRoles]), validate({ body: checkUploadSchema }), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    if (!companyId) {
        throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
    }
    const origin = `${req.protocol}://${req.get("host") || ""}`;
    const uploaded = await service.uploadReceiptImage({
        companyId,
        fileName: req.body.fileName,
        mimeType: req.body.mimeType,
        dataBase64: req.body.dataBase64,
        origin
    });
    res.status(201).json(uploaded);
}));

cashLogRouter.post("/", requireRole([...cashLogWriteRoles]), validate({ body: cashLogCreateSchema }), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    if (!companyId) {
        throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
    }
    const saved = await service.create({
        companyId,
        createdByUserId: req.auth.userId,
        direction: req.body.direction,
        amount: req.body.amount,
        memo: req.body.memo,
        entryDate: req.body.entryDate,
        payeeCompany: req.body.payeeCompany,
        invoiceNumber: req.body.invoiceNumber,
        department: req.body.department,
        receiptImageUrls: req.body.receiptImageUrls
    });
    res.status(201).json(saved);
}));

cashLogRouter.patch("/:id", requireRole([...cashLogWriteRoles]), validate({ params: cashLogIdParam, body: cashLogUpdateSchema }), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    if (!companyId) {
        throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
    }
    const updated = await service.updateById(companyId, req.params.id, req.body);
    logInfo("[ADMIN] cash_log_update", {
        companyId,
        entryId: req.params.id,
        actorUserId: req.auth?.userId
    });
    res.json(updated);
}));

cashLogRouter.post(
    "/:id/leaflink-match",
    requireRole([...cashLogLeafLinkRoles]),
    validate({ params: cashLogIdParam, body: cashLeafLinkMatchSchema }),
    asyncHandler(async (req, res) => {
        const companyId = getScopedCompanyId(req);
        if (!companyId) {
            throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
        }
        const out = await service.matchLeafLinkIncoming(companyId, req.params.id, {
            refreshIfNoMatch: req.body?.refreshIfNoMatch,
        });
        res.json(out);
    }),
);

cashLogRouter.post(
    "/:id/leaflink-mark-paid",
    requireRole([...cashLogLeafLinkRoles]),
    validate({ params: cashLogIdParam, body: cashLeafLinkMarkPaidSchema }),
    asyncHandler(async (req, res) => {
        const companyId = getScopedCompanyId(req);
        if (!companyId || !req.auth?.userId) {
            throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
        }
        const body = req.body as z.infer<typeof cashLeafLinkMarkPaidSchema>;
        const out = await service.markLeafLinkIncomingPaid(companyId, req.auth.userId, req.params.id, body);
        res.json(out);
    }),
);

cashLogRouter.delete("/:id", requireRole([...cashLogWriteRoles]), validate({ params: cashLogIdParam }), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    if (!companyId) {
        throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
    }
    await service.deleteById(companyId, req.params.id);
    logInfo("[ADMIN] cash_log_delete", {
        companyId,
        entryId: req.params.id,
        actorUserId: req.auth?.userId
    });
    res.status(204).send();
}));

cashLogRouter.get("/eod-prefs", requireRole([...cashLogReadRoles]), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const userId = req.auth?.userId as string | undefined;
    if (!companyId || !userId) {
        throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
    }
    const m = await prisma.companyMembership.findUnique({
        where: { userId_companyId: { userId, companyId } },
        select: { id: true, role: true, cashLogEodPrefs: true },
    });
    const prefs = mergeCashLogEodPrefs(m?.cashLogEodPrefs ?? null);
    if (m?.role === "owner") {
        if (prefs.enabled && m.id) {
            const repaired = cashLogEodPrefsSchema.parse({ ...prefs, enabled: false });
            await prisma.companyMembership.update({
                where: { id: m.id },
                data: { cashLogEodPrefs: repaired },
            });
            logInfo("[cash_log_eod] owner_digest_disabled_read_repair", {
                membershipId: m.id,
                companyId,
                userId,
            });
        }
        res.json({ prefs: { ...prefs, enabled: false } });
        return;
    }
    res.json({ prefs });
}));

cashLogRouter.put(
    "/eod-prefs",
    requireRole([...cashLogReadRoles]),
    validate({ body: cashLogEodPrefsSchema }),
    asyncHandler(async (req, res) => {
        const companyId = getScopedCompanyId(req);
        const userId = req.auth?.userId as string | undefined;
        if (!companyId || !userId) {
            throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
        }
        const caller = await prisma.companyMembership.findUnique({
            where: { userId_companyId: { userId, companyId } },
            select: { id: true, role: true },
        });
        if (!caller) {
            throw new AppError("Company membership not found", 404, "MEMBERSHIP_NOT_FOUND");
        }
        let body = req.body as z.infer<typeof cashLogEodPrefsSchema>;
        if (caller.role === "owner") {
            if (body.enabled) {
                logInfo("[cash_log_eod] owner_digest_force_disabled_on_save", {
                    membershipId: caller.id,
                    companyId,
                    userId,
                });
            }
            body = cashLogEodPrefsSchema.parse({ ...body, enabled: false });
        }
        await prisma.$transaction(async (tx) => {
            await tx.companyMembership.update({
                where: { id: caller.id },
                data: {
                    cashLogEodPrefs: body,
                    cashLogEodScheduleGeneration: { increment: 1 },
                    cashLogEodDigestSentScheduleGeneration: null,
                },
            });
            const peers = await tx.companyMembership.findMany({
                where: { companyId, NOT: { id: caller.id } },
                select: { id: true, cashLogEodPrefs: true },
            });
            let propagated = 0;
            for (const row of peers) {
                if (row.cashLogEodPrefs == null) continue;
                const next = mergeScheduleIntoExistingMembershipPrefs(body, row.cashLogEodPrefs);
                await tx.companyMembership.update({
                    where: { id: row.id },
                    data: {
                        cashLogEodPrefs: next,
                        cashLogEodScheduleGeneration: { increment: 1 },
                        cashLogEodDigestSentScheduleGeneration: null,
                    },
                });
                propagated += 1;
            }
            if (propagated > 0) {
                logInfo("[cash_log_eod] schedule_propagated_company_wide", {
                    companyId,
                    actorUserId: userId,
                    peerMembershipsUpdated: propagated,
                });
            }
        });
        res.json({ prefs: body });
    }),
);
