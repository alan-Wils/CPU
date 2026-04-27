import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { requireRole } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { checkExtractSchema, checkSaveSchema, checkUploadSchema } from "../../validation/schemas.js";
import { CheckCaptureService } from "../../services/checkCaptureService.js";
import { AppError } from "../../errors/AppError.js";

const writeRoles = [
  "OWNER",
  "ADMIN",
  "OPERATIONS_MANAGER",
  "CULTIVATION_SPECIALIST",
  "EXTRACTION_SPECIALIST",
  "PACKAGING_SPECIALIST"
] as const;

const listQuerySchema = z.object({
  take: z.coerce.number().int().positive().max(200).optional()
});

export const checksRouter = Router();
const service = new CheckCaptureService();

checksRouter.get(
  "/",
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    const companyId = String(req.auth?.companyId ?? "").trim();
    if (!companyId) {
      throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
    }
    const rawTake = (req.query as { take?: unknown }).take;
    const coerced = rawTake === undefined || rawTake === "" ? 50 : Number(rawTake);
    const take = Number.isFinite(coerced) ? coerced : 50;
    const rows = await service.listChecks(companyId, take);
    res.json({ rows });
  })
);

checksRouter.post(
  "/upload",
  requireRole([...writeRoles]),
  validate({ body: checkUploadSchema }),
  asyncHandler(async (req, res) => {
    const origin = `${req.protocol}://${req.get("host") || ""}`;
    const uploaded = await service.uploadImage({
      companyId: req.auth!.companyId,
      fileName: req.body.fileName,
      mimeType: req.body.mimeType,
      dataBase64: req.body.dataBase64,
      origin
    });
    res.status(201).json(uploaded);
  })
);

checksRouter.post(
  "/extract",
  requireRole([...writeRoles]),
  validate({ body: checkExtractSchema }),
  asyncHandler(async (req, res) => {
    const extracted = await service.extractFields({
      imageUrl: req.body.imageUrl,
      dataBase64: req.body.dataBase64,
      mimeType: req.body.mimeType
    });
    res.json(extracted);
  })
);

checksRouter.post(
  "/",
  requireRole([...writeRoles]),
  validate({ body: checkSaveSchema }),
  asyncHandler(async (req, res) => {
    const saved = await service.saveCheck({
      companyId: req.auth!.companyId,
      createdByUserId: req.auth!.userId,
      checkDate: req.body.checkDate,
      amount: req.body.amount,
      checkNumber: req.body.checkNumber,
      payerName: req.body.payerName,
      routingNumber: req.body.routingNumber,
      accountNumber: req.body.accountNumber,
      bankName: req.body.bankName,
      memo: req.body.memo,
      imageUrl: req.body.imageUrl,
      rawOcrJson: req.body.rawOcrJson
    });
    res.status(201).json(saved);
  })
);
