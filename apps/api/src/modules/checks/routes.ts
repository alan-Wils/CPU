import { Router } from "express";
import { z } from "zod";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { requireRole } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import {
    checkCaptureUpdateSchema,
    checkExtractSchema,
    checkLeafLinkMarkPaidSchema,
    checkLeafLinkMatchSchema,
    checkSaveSchema,
    checkUploadSchema
} from "../../validation/schemas.js";
import { CheckCaptureService } from "../../services/checkCaptureService.js";
import { AppError } from "../../errors/AppError.js";
import { logInfo } from "../../lib/logger.js";
const writeRoles = [
    "OWNER",
    "ADMIN",
    "OPERATIONS_MANAGER",
    "CULTIVATION_SPECIALIST",
    "EXTRACTION_SPECIALIST",
    "PACKAGING_SPECIALIST"
];
const adminExportRoles = ["OWNER", "ADMIN"];
const managerOrAdminRoles = ["OWNER", "ADMIN", "OPERATIONS_MANAGER"];
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const listQuerySchema = z.object({
    take: z.coerce.number().int().positive().max(200).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    payee: z.string().trim().max(200).optional()
});
const exportQuerySchema = z.object({
    from: isoDate,
    to: isoDate,
    payee: z.string().trim().max(200).optional()
});
const checkCaptureIdParam = z.object({ id: z.string().cuid() });
export const checksRouter = Router();
const service = new CheckCaptureService();
checksRouter.get("/export", requireRole([...adminExportRoles]), validate({ query: exportQuerySchema }), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    if (!companyId) {
        throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
    }
    const from = String(req.query.from);
    const to = String(req.query.to);
    const payee = typeof req.query.payee === "string" ? req.query.payee : undefined;
    const rows = await service.listChecksForExport(companyId, { from, to, payee });
    const csv = service.rowsToCsv(rows);
    const safeFrom = from.replace(/[^\d-]/g, "");
    const safeTo = to.replace(/[^\d-]/g, "");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="check-captures-${safeFrom}_${safeTo}.csv"`);
    res.send(csv);
}));
checksRouter.get("/", validate({ query: listQuerySchema }), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    if (!companyId) {
        throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
    }
    const take = Number(req.query?.take || 50);
    const from = typeof req.query?.from === "string" ? req.query.from : undefined;
    const to = typeof req.query?.to === "string" ? req.query.to : undefined;
    const payee = typeof req.query?.payee === "string" ? req.query.payee : undefined;
    const rows = await service.listChecks(companyId, take, { from, to, payee });
    res.json({ rows });
}));
checksRouter.post("/upload", requireRole([...writeRoles]), validate({ body: checkUploadSchema }), asyncHandler(async (req, res) => {
    const origin = `${req.protocol}://${req.get("host") || ""}`;
    const uploaded = await service.uploadImage({
        companyId: getScopedCompanyId(req),
        fileName: req.body.fileName,
        mimeType: req.body.mimeType,
        dataBase64: req.body.dataBase64,
        origin
    });
    res.status(201).json(uploaded);
}));
checksRouter.post("/extract", requireRole([...writeRoles]), validate({ body: checkExtractSchema }), asyncHandler(async (req, res) => {
    const extracted = await service.extractFields({
        imageUrl: req.body.imageUrl,
        dataBase64: req.body.dataBase64,
        mimeType: req.body.mimeType
    });
    res.json(extracted);
}));
checksRouter.post("/", requireRole([...writeRoles]), validate({ body: checkSaveSchema }), asyncHandler(async (req, res) => {
    const saved = await service.saveCheck({
        companyId: getScopedCompanyId(req),
        createdByUserId: req.auth.userId,
        checkDate: req.body.checkDate,
        amount: req.body.amount,
        checkNumber: req.body.checkNumber,
        payerName: req.body.payerName,
        routingNumber: req.body.routingNumber,
        accountNumber: req.body.accountNumber,
        bankName: req.body.bankName,
        memo: req.body.memo,
        invoiceNumber: req.body.invoiceNumber,
        imageUrl: req.body.imageUrl,
        stubImageUrl: req.body.stubImageUrl,
        rawOcrJson: req.body.rawOcrJson
    });
    res.status(201).json(saved);
}));
checksRouter.patch("/:id", requireRole([...adminExportRoles]), validate({ params: checkCaptureIdParam, body: checkCaptureUpdateSchema }), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    if (!companyId) {
        throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
    }
    const updated = await service.updateById(companyId, req.params.id, req.body);
    logInfo("[ADMIN] check_capture_update", {
        companyId,
        captureId: req.params.id,
        actorUserId: req.auth?.userId
    });
    res.json(updated);
}));
checksRouter.post("/:id/leaflink-match", requireRole([...managerOrAdminRoles]), validate({ params: checkCaptureIdParam, body: checkLeafLinkMatchSchema }), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    if (!companyId) {
        throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
    }
    const matches = await service.matchLeafLinkInvoice(companyId, req.params.id, req.body);
    res.json(matches);
}));
checksRouter.post("/:id/leaflink-mark-paid", requireRole([...managerOrAdminRoles]), validate({ params: checkCaptureIdParam, body: checkLeafLinkMarkPaidSchema }), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    if (!companyId) {
        throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
    }
    const result = await service.markLeafLinkInvoicePaid(companyId, req.auth.userId, req.params.id, req.body);
    res.json(result);
}));
checksRouter.delete("/:id", requireRole([...adminExportRoles]), validate({ params: checkCaptureIdParam }), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    if (!companyId) {
        throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
    }
    await service.deleteById(companyId, req.params.id);
    logInfo("[ADMIN] check_capture_delete", {
        companyId,
        captureId: req.params.id,
        actorUserId: req.auth?.userId
    });
    res.status(204).send();
}));
