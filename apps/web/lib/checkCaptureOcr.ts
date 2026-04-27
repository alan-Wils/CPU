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

export type LocalOcrRunOptions = {
  /** Shown while the worker loads and each rotation runs (first load can take 30–90s). */
  onPhase?: (message: string) => void;
  /** Abort and reject if OCR does not finish in time (default 3 minutes). */
  timeoutMs?: number;
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

/**
 * Pull the most likely printed check amount. OCR often emits a tiny false positive
 * (e.g. "1.00") before the real total (e.g. "$1,000.00"), so we scan all candidates and
 * prefer the largest plausible value.
 */
function extractPrimaryCheckAmount(raw: string): number | undefined {
  const text = String(raw || "").replace(/\r/g, "");
  const candidates: number[] = [];

  const pushAmount = (intPart: string, cents: string) => {
    const left = String(intPart || "").replace(/,/g, "");
    if (!/^\d+$/.test(left)) return;
    if (!/^\d{2}$/.test(cents)) return;
    const n = Number(`${left}.${cents}`);
    if (!Number.isFinite(n) || n < 0.01 || n > 99_000_000) return;
    candidates.push(n);
  };

  const dollarRe = /\$\s*([\d,]+)\.(\d{2})\b/g;
  let m: RegExpExecArray | null;
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

  if (!candidates.length) return undefined;
  return Math.max(...candidates);
}

/** Heuristic parser for OCR text from personal / business checks (US-style). */
export function parseCheckTextFromOcr(text: string): ParsedCheckFields {
  const raw = String(text || "").replace(/\r/g, "");
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const amount = extractPrimaryCheckAmount(raw);

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
        const nw = Math.max(2, img.naturalWidth || 2);
        const nh = Math.max(2, img.naturalHeight || 2);
        const baseW = (swap ? nh : nw) * upscale;
        const baseH = (swap ? nw : nh) * upscale;
        const MIN_DIM = 320;
        const pad = Math.max(1, MIN_DIM / baseW, MIN_DIM / baseH);
        const w = Math.round(baseW * pad);
        const h = Math.round(baseH * pad);
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
        const drawW = nw * upscale * pad;
        const drawH = nh * upscale * pad;
        ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
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

/** Enough structured fields to stop scanning more angles / variants. */
function isExtractionGoodEnough(parsed: ParsedCheckFields, fieldCount: number): boolean {
  if (fieldCount >= 5) return true;
  if (fieldCount >= 4 && parsed.amount != null && parsed.routingNumber) return true;
  return false;
}

function mergeOcrCandidate(
  prev: LocalOcrBestResult,
  text: string,
  angle: number,
  parsed: ParsedCheckFields,
  confidence: number
): LocalOcrBestResult {
  const scored = scoreParsedResult(text, parsed);
  const score = scored.score + Math.max(0, confidence) * 0.5;
  if (score <= prev.score) return prev;
  return {
    text,
    angle,
    parsed,
    score,
    fieldsDetected: scored.fieldCount
  };
}

type TessWorker = Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>;

let sharedCheckOcrWorkerPromise: Promise<TessWorker> | null = null;
let sharedWorkerUnloadHooked = false;

async function getSharedCheckOcrWorker(): Promise<TessWorker> {
  if (!sharedCheckOcrWorkerPromise) {
    sharedCheckOcrWorkerPromise = (async () => {
      const { createWorker, PSM } = await import("tesseract.js");
      const worker = await createWorker("eng");
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: "1"
      });
      return worker;
    })();
  }
  try {
    return await sharedCheckOcrWorkerPromise;
  } catch (e) {
    sharedCheckOcrWorkerPromise = null;
    throw e;
  }
}

async function resetSharedCheckOcrWorker(): Promise<void> {
  const p = sharedCheckOcrWorkerPromise;
  sharedCheckOcrWorkerPromise = null;
  if (!p) return;
  try {
    const w = await p;
    await w.terminate();
  } catch {
    // ignore
  }
}

function ensureSharedCheckOcrWorkerReleasedOnLeave(): void {
  if (sharedWorkerUnloadHooked || typeof window === "undefined") return;
  sharedWorkerUnloadHooked = true;
  const release = () => {
    void resetSharedCheckOcrWorker();
  };
  window.addEventListener("pagehide", release);
}

const FAST_ANGLES = [0, 90] as const;
const EXTRA_ANGLES = [180, 270] as const;

/** Serialize runs so the shared Tesseract worker is never used concurrently. */
let localOcrQueue: Promise<unknown> = Promise.resolve();

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  if (ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/**
 * Runs Tesseract in the browser across rotations (0°/90° first, then 180°/270° if needed).
 * Reuses one worker per tab, skips redundant enhanced passes when base OCR is already strong,
 * and stops early once enough fields are parsed.
 */
export function runLocalCheckOcr(file: File, opts?: LocalOcrRunOptions): Promise<LocalOcrBestResult> {
  const run = localOcrQueue.then(() => runLocalCheckOcrCore(file, opts));
  localOcrQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function runLocalCheckOcrCore(file: File, opts?: LocalOcrRunOptions): Promise<LocalOcrBestResult> {
  ensureSharedCheckOcrWorkerReleasedOnLeave();
  const onPhase = opts?.onPhase;
  const timeoutMs = opts?.timeoutMs ?? 180_000;

  const work = async (): Promise<LocalOcrBestResult> => {
    onPhase?.(
      "Loading OCR engine… The first run may download language data (often 30–90 seconds on a slow connection)."
    );

    let best: LocalOcrBestResult = {
      text: "",
      angle: 0,
      parsed: {},
      score: -1,
      fieldsDetected: 0
    };

    const runRecognize = async (worker: TessWorker, blob: Blob, angle: number) => {
      const { data } = await worker.recognize(blob);
      const text = String(data?.text || "");
      const parsed = parseCheckTextFromOcr(text);
      const confidence = Number(data?.confidence || 0);
      best = mergeOcrCandidate(best, text, angle, parsed, confidence);
      const scored = scoreParsedResult(text, parsed);
      return { text, parsed, scored, confidence };
    };

    try {
      const worker = await getSharedCheckOcrWorker();
      onPhase?.("OCR ready. Reading your check…");

      const processAngles = async (angles: readonly number[], label: string) => {
        for (const angle of angles) {
          onPhase?.(`${label} ${angle}°…`);
          const rotated = await blobToPngWithRotation(file, angle, 2);
          const base = await runRecognize(worker, rotated, angle);
          if (isExtractionGoodEnough(best.parsed, best.fieldsDetected)) return;

          const tryEnhance = !isExtractionGoodEnough(base.parsed, base.scored.fieldCount);
          if (tryEnhance) {
            onPhase?.(`${label} ${angle}° (contrast boost)…`);
            const enhanced = await enhanceForOcr(rotated);
            await runRecognize(worker, enhanced, angle);
            if (isExtractionGoodEnough(best.parsed, best.fieldsDetected)) return;
          }
        }
      };

      await processAngles(FAST_ANGLES, "Reading at");
      if (!isExtractionGoodEnough(best.parsed, best.fieldsDetected)) {
        await processAngles(EXTRA_ANGLES, "Trying");
      }
    } catch (e) {
      await resetSharedCheckOcrWorker();
      throw e;
    }

    return best;
  };

  return withTimeout(
    work(),
    timeoutMs,
    "On-device OCR timed out. Try again, use a smaller or sharper photo, or check your network (first run downloads OCR data)."
  );
}

const UPLOAD_IMAGE_TYPE = /^image\/(jpeg|jpg|png|webp)$/i;

/**
 * Downscales very large camera photos before base64 upload and local OCR (faster I/O and recognition).
 * Returns the original file when already small enough or when decode fails.
 */
export async function shrinkCheckImageFileIfLarge(file: File, maxEdge = 2000): Promise<File> {
  const type = (file.type || "").toLowerCase();
  if (!UPLOAD_IMAGE_TYPE.test(type) || !file.size) return file;

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not decode image"));
      img.src = url;
    });
    const nw = img.naturalWidth || 0;
    const nh = img.naturalHeight || 0;
    if (!nw || !nh) return file;

    const scale = Math.min(1, maxEdge / Math.max(nw, nh));
    if (scale >= 1) return file;

    const tw = Math.round(nw * scale);
    const th = Math.round(nh * scale);
    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, tw, th);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.88)
    );
    if (!blob) return file;

    const baseName = file.name.replace(/\.[^.\\/]+$/, "") || "check";
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}
