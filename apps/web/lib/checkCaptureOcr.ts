export type ParsedCheckFields = {
  checkDate?: string;
  amount?: number;
  checkNumber?: string;
  payerName?: string;
  routingNumber?: string;
  accountNumber?: string;
  bankName?: string;
  memo?: string;
};

export type LocalOcrBestResult = {
  text: string;
  angle: number;
  parsed: ParsedCheckFields;
  score: number;
  fieldsDetected: number;
};

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

/** Heuristic parser for OCR text from personal / business checks (US-style). */
export function parseCheckTextFromOcr(text: string): ParsedCheckFields {
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
      if (mon) {
        const dd = d2[2].padStart(2, "0");
        checkDate = `${d2[3]}-${mon}-${dd}`;
      }
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
  let memo = memoLine ? memoLine.replace(/^memo[:\s]*/i, "").trim() : undefined;

  if (!memo) {
    const memoLabelIdx = lines.findIndex((line) => /^memo[:\s]*$/i.test(line));
    if (memoLabelIdx >= 0) {
      memo = String(lines[memoLabelIdx + 1] || "").trim() || undefined;
    }
  }

  if (!memo) {
    // Common numeric memo format: "10081 CS 00611" (or similar token groups).
    memo =
      lines.find((line) => /\b\d{3,}\s+[A-Z]{1,4}\s+\d{3,}\b/i.test(line) && line.length <= 60) || undefined;
  }

  const bankName =
    lines.find((line) => /(bank|credit union|financial|N\.A\.|N\.A\b)/i.test(line) && line.length <= 120) || undefined;

  if (!payerName) {
    // Fallback for business checks where payer name is printed in the top-left header.
    payerName =
      lines.find(
        (line) =>
          /(llc|inc|corp|company|healthcare|holdings|enterprises|group|services)/i.test(line) &&
          !/(bank|credit union|financial)/i.test(line) &&
          line.length <= 200
      ) || undefined;
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

function blobToPngWithRotation(file: File, degrees: number, upscale = 1): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const rad = (degrees * Math.PI) / 180;
        const swap = degrees % 180 !== 0;
        const w = (swap ? img.naturalHeight : img.naturalWidth) * upscale;
        const h = (swap ? img.naturalWidth : img.naturalHeight) * upscale;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error("Canvas not available"));
          return;
        }
        ctx.translate(w / 2, h / 2);
        ctx.rotate(rad);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(
          img,
          -((img.naturalWidth * upscale) / 2),
          -((img.naturalHeight * upscale) / 2),
          img.naturalWidth * upscale,
          img.naturalHeight * upscale
        );
        URL.revokeObjectURL(url);
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error("Could not encode image"));
          },
          "image/png",
          0.92
        );
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not load image"));
    };
    img.src = url;
  });
}

function enhanceForOcr(blob: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error("Canvas not available"));
          return;
        }
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const p = data.data;
        for (let i = 0; i < p.length; i += 4) {
          const gray = p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114;
          const boosted = gray > 155 ? 255 : Math.max(0, gray - 25);
          p[i] = boosted;
          p[i + 1] = boosted;
          p[i + 2] = boosted;
        }
        ctx.putImageData(data, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob(
          (out) => {
            if (out) resolve(out);
            else reject(new Error("Could not encode enhanced image"));
          },
          "image/png",
          0.95
        );
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not load image"));
    };
    img.src = url;
  });
}

function parsedFieldCount(p: ParsedCheckFields): number {
  return [
    p.checkDate,
    p.amount,
    p.checkNumber,
    p.payerName,
    p.routingNumber,
    p.accountNumber,
    p.bankName,
    p.memo
  ].filter((v) => v !== undefined && v !== "").length;
}

function scoreParsedResult(text: string, parsed: ParsedCheckFields): { score: number; fieldCount: number } {
  const fieldCount = parsedFieldCount(parsed);
  if (fieldCount <= 0) {
    // If no fields were parsed, keep the score very low so we don't falsely prefer noisy OCR.
    return { score: text.length * 0.001, fieldCount };
  }
  // Primary signal: parsed fields. Secondary signal: text length as tie-breaker only.
  return { score: fieldCount * 1000 + Math.min(text.length, 500), fieldCount };
}

/**
 * Runs Tesseract in the browser on the image at 0° and 90° (common for phone photos of landscape checks).
 * Picks the orientation that yields the most parsed fields.
 */
export async function runLocalCheckOcr(file: File): Promise<LocalOcrBestResult> {
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("eng");
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    preserve_interword_spaces: "1"
  });

  let best: LocalOcrBestResult = {
    text: "",
    angle: 0,
    parsed: {},
    score: -1,
    fieldsDetected: 0
  };

  try {
    for (const angle of [0, 90, 180, 270]) {
      for (const variant of ["base", "enhanced"] as const) {
        const rotated = await blobToPngWithRotation(file, angle, 2);
        const blob = variant === "enhanced" ? await enhanceForOcr(rotated) : rotated;
        const { data } = await worker.recognize(blob);
        const text = String(data?.text || "");
        const parsed = parseCheckTextFromOcr(text);
        const confidence = Number(data?.confidence || 0);
        const scored = scoreParsedResult(text, parsed);
        const score = scored.score + Math.max(0, confidence) * 0.5;
        if (score > best.score) {
          best = {
            text,
            angle,
            parsed,
            score,
            fieldsDetected: scored.fieldCount
          };
        }
      }
    }
  } finally {
    await worker.terminate();
  }

  return best;
}
