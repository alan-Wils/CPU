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

const MONTH_NAME =
  /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i;
const MONTH_MAP: Record<string, string> = {
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

function parseCheckText(text: string) {
  const raw = String(text || "").replace(/\r/g, "");
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  let amount: number | undefined;
  const amtDollar = raw.match(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*\.\d{2})\b/);
  if (amtDollar) amount = Number(amtDollar[1].replace(/,/g, ""));
  if (amount === undefined) {
    const amtPlain = raw.match(/\b([0-9]{1,3}(?:,[0-9]{3})*\.\d{2})\b/);
    if (amtPlain) amount = Number(amtPlain[1].replace(/,/g, ""));
  }

  let payerName: string | undefined;
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
    if (payee2) payerName = payee2[1].trim().replace(/\s+/g, " ").slice(0, 200);
  }

  let checkNumber: string | undefined;
  const cn1 = raw.match(/(?:CHECK|CHK)\s*#?\s*[:]?\s*(\d{2,12})/i);
  const cn2 = raw.match(/\bNo\.?\s*#?\s*(\d{2,12})\b/i);
  if (cn1) checkNumber = cn1[1];
  else if (cn2) checkNumber = cn2[1];

  let checkDate: string | undefined;
  const d1 = raw.match(/\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])[\/\-](\d{2,4})\b/);
  if (d1) {
    const [mm, dd, yyyy] = [d1[1], d1[2], d1[3]];
    const year = yyyy.length === 2 ? `20${yyyy}` : yyyy;
    checkDate = `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  } else {
    const d2 = raw.match(MONTH_NAME);
    if (d2) {
      const mon = MONTH_MAP[d2[1].toLowerCase()];
      if (mon) checkDate = `${d2[3]}-${mon}-${d2[2].padStart(2, "0")}`;
    }
  }

  let routingNumber: string | undefined;
  let accountNumber: string | undefined;
  const micr = raw.replace(/\s+/g, " ").match(/(\d{9})\D+(\d{4,17})\D+(\d{2,10})\b/);
  if (micr) {
    routingNumber = micr[1];
    accountNumber = micr[2];
    if (!checkNumber) checkNumber = micr[3];
  } else {
    const rt = raw.match(/\b(\d{9})\b/);
    if (rt) routingNumber = rt[1];
    const accts = raw.match(/\b(\d{10,17})\b/g);
    if (accts) {
      accountNumber = accts.find((a) => a !== routingNumber);
    }
  }

  const memoLine = lines.find((line) => /^memo[:\s]/i.test(line)) || "";
  const memo = memoLine ? memoLine.replace(/^memo[:\s]*/i, "").trim() : undefined;
  const bankName =
    lines.find((line) => /(bank|credit union|financial|N\.A\.|N\.A\b)/i.test(line) && line.length <= 120) ||
    undefined;

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
