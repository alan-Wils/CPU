import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";

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

function parseCheckText(text: string) {
  const compact = String(text || "").replace(/\r/g, "");
  const amountMatch = compact.match(/\$?\s?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+\.[0-9]{2})/);
  const checkNumberMatch =
    compact.match(/\b(?:check|chk|no\.?|#)\s*[:\-]?\s*([0-9]{3,12})\b/i) ||
    compact.match(/\b([0-9]{3,12})\b(?!.*\b[0-9]{3,12}\b)/);
  const routingMatch = compact.match(/\b([0-9]{9})\b/);
  const accountMatch = compact.match(/\b([0-9]{6,17})\b/g);
  const dateMatch = compact.match(/\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12][0-9]|3[01])[\/\-]([0-9]{2,4})\b/);

  const lines = compact
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const memoLine = lines.find((line) => /^memo[:\s]/i.test(line)) || "";
  const memo = memoLine ? memoLine.replace(/^memo[:\s]*/i, "").trim() : undefined;
  const bankName =
    lines.find((line) => /(bank|credit union|financial)/i.test(line) && line.length <= 80) || undefined;
  const payerName =
    lines.find((line) => /^[A-Za-z][A-Za-z0-9 .,'-]{3,80}$/.test(line) && !/(bank|memo|pay to)/i.test(line)) ||
    undefined;

  let checkDate: string | undefined;
  if (dateMatch) {
    const [mm, dd, yyyy] = dateMatch[0].split(/[/-]/);
    const year = yyyy.length === 2 ? `20${yyyy}` : yyyy;
    checkDate = `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  const accountNumber = accountMatch?.find((value) => value !== routingMatch?.[1]);

  return {
    checkDate,
    amount: amountMatch ? Number(amountMatch[1].replace(/,/g, "")) : undefined,
    checkNumber: checkNumberMatch?.[1],
    payerName,
    routingNumber: routingMatch?.[1],
    accountNumber,
    bankName,
    memo
  };
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
    const parsedText = String(payload?.ParsedResults?.[0]?.ParsedText || "");
    const parsed = parseCheckText(parsedText);

    return {
      provider: "ocr-space",
      parsed,
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
    return prisma.checkCapture.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(take, 1), 200)
    });
  }
}
