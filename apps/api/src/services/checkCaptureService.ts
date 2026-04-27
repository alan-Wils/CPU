import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { parseCheckOcrTextWithConfidence, toFlatParsedForApi } from "@cpu/shared";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";
import { logError } from "../lib/logger.js";

type UploadInput = {
  companyId: string;
  fileName?: string;
  mimeType: "image/jpeg" | "image/jpg" | "image/png" | "image/webp";
  dataBase64: string;
  origin: string;
};

type ExtractInput = {
  imageUrl?: string;
  dataBase64?: string;
  mimeType?: "image/jpeg" | "image/jpg" | "image/png" | "image/webp";
};

type SaveInput = {
  companyId: string;
  createdByUserId: string;
  checkDate?: Date;
  amount?: number;
  checkNumber?: string;
  payerName?: string;
  routingNumber?: string;
  accountNumber?: string;
  bankName?: string;
  memo?: string;
  imageUrl: string;
  rawOcrJson?: unknown;
};

function extForMime(mimeType: UploadInput["mimeType"]): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

export class CheckCaptureService {
  async uploadImage(input: UploadInput) {
    const base64 = String(input.dataBase64 || "").replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(base64, "base64");
    if (!buffer.length) {
      throw new AppError("Invalid check image data", 400, "CHECK_IMAGE_INVALID");
    }
    if (buffer.length > env.CHECK_UPLOAD_MAX_BYTES) {
      throw new AppError(`Image exceeds ${env.CHECK_UPLOAD_MAX_BYTES} byte limit`, 413, "CHECK_IMAGE_TOO_LARGE");
    }

    const ext = extForMime(input.mimeType);
    const safeName = `${Date.now()}-${randomUUID().slice(0, 12)}.${ext}`;
    const directory = path.join(process.cwd(), "uploads", "checks", input.companyId);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, safeName), buffer);

    return {
      imageUrl: `${input.origin}/uploads/checks/${input.companyId}/${safeName}`,
      bytes: buffer.length
    };
  }

  async extractFields(input: ExtractInput) {
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
        confidenceByField: {},
        parseQuality: "empty" as const,
        warnings: ["OCR_SPACE_API_KEY not configured — use browser OCR or set OCR_SPACE_API_KEY."],
        raw: { reason: "OCR_SPACE_API_KEY not configured" }
      };
    }

    const body = new URLSearchParams();
    body.set("apikey", apiKey);
    body.set("language", "eng");
    body.set("isOverlayRequired", "false");
    body.set("OCREngine", "2");
    if (input.imageUrl) body.set("url", input.imageUrl);
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

    const payload = (await response.json()) as any;
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
        confidenceByField: {},
        parseQuality: "weak" as const,
        warnings: ["OCR.space returned no parsed text — try browser OCR or a clearer photo."],
        raw: payload
      };
    }

    const parsedText = String(payload?.ParsedResults?.[0]?.ParsedText || "");
    const detail = parseCheckOcrTextWithConfidence(parsedText);

    return {
      provider: "ocr-space",
      parsed: toFlatParsedForApi(detail),
      confidenceByField: detail.confidenceByField,
      parseQuality: detail.parseQuality,
      warnings: detail.warnings,
      raw: payload
    };
  }

  async saveCheck(input: SaveInput) {
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
        imageUrl: input.imageUrl,
        rawOcrJson: input.rawOcrJson ? JSON.stringify(input.rawOcrJson) : undefined
      }
    });
    return row;
  }

  async listChecks(companyId: string, take = 50) {
    const safeTake = Number.isFinite(take) ? Math.min(200, Math.max(1, Math.floor(Number(take)))) : 50;
    try {
      return await prisma.checkCapture.findMany({
        where: { companyId },
        orderBy: { createdAt: "desc" },
        take: safeTake,
        // List view only: skip rawOcrJson (large) and skip company-scoped columns the UI does not use.
        select: {
          id: true,
          checkDate: true,
          amount: true,
          checkNumber: true,
          payerName: true,
          routingNumber: true,
          accountNumber: true,
          bankName: true,
          memo: true,
          imageUrl: true,
          createdAt: true
        }
      });
    } catch (err) {
      logError("check_capture_list_failed", {
        companyId,
        take: safeTake,
        name: err instanceof Error ? err.name : "unknown",
        message: err instanceof Error ? err.message : String(err)
      });
      throw err;
    }
  }
}
