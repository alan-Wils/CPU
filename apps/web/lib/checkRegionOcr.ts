import {
  mergeCheckParsedPreferBetter,
  parseCheckOcrTextWithConfidence,
  toFlatParsedForApi,
  type CheckParseResult
} from "@cpu/shared";

export type LocalOcrBestResult = {
  text: string;
  angle: number;
  parsed: ReturnType<typeof toFlatParsedForApi>;
  score: number;
  fieldsDetected: number;
  confidenceByField: Partial<Record<string, number>>;
  timingsMs: Record<string, number>;
  parseQuality: CheckParseResult["parseQuality"];
  warnings: string[];
  croppedRegionText?: Record<string, string>;
};

import { CHECK_REGIONS, type RegionId, regionPixelRect } from "./checkRegionGeometry";

type TessWorker = Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>;

let sharedWorkerPromise: Promise<TessWorker> | null = null;
let ocrQueue: Promise<unknown> = Promise.resolve();

async function getWorker(): Promise<TessWorker> {
  if (!sharedWorkerPromise) {
    sharedWorkerPromise = (async () => {
      const { createWorker, PSM } = await import("tesseract.js");
      const w = await createWorker("eng");
      await w.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: "1"
      });
      return w;
    })();
  }
  try {
    return await sharedWorkerPromise;
  } catch (e) {
    sharedWorkerPromise = null;
    throw e;
  }
}

function blobToPngCanvas(file: File, degrees: number, maxEdge = 1200): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const rad = (degrees * Math.PI) / 180;
        const swap = degrees % 180 !== 0;
        const nw = Math.max(2, img.naturalWidth || 2);
        const nh = Math.max(2, img.naturalHeight || 2);
        let cw = swap ? nh : nw;
        let ch = swap ? nw : nh;
        const scale = Math.min(1, maxEdge / Math.max(cw, ch));
        cw = Math.round(cw * scale);
        ch = Math.round(ch * scale);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(2, cw);
        canvas.height = Math.max(2, ch);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error("No canvas"));
          return;
        }
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(rad);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        const dw = nw * scale;
        const dh = nh * scale;
        ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
        URL.revokeObjectURL(url);
        resolve(canvas);
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image load failed"));
    };
    img.src = url;
  });
}

function preprocessRegionCanvas(source: HTMLCanvasElement, rx: number, ry: number, rw: number, rh: number) {
  const crop = document.createElement("canvas");
  crop.width = rw;
  crop.height = rh;
  const c = crop.getContext("2d");
  if (!c) return crop;
  c.drawImage(source, rx, ry, rw, rh, 0, 0, rw, rh);
  const minSide = 140;
  if (rw < minSide || rh < minSide) {
    const s = minSide / Math.min(rw, rh);
    const up = document.createElement("canvas");
    up.width = Math.round(rw * s);
    up.height = Math.round(rh * s);
    const u = up.getContext("2d");
    if (u) {
      u.imageSmoothingEnabled = true;
      u.imageSmoothingQuality = "high";
      u.drawImage(crop, 0, 0, up.width, up.height);
      return enhanceBinary(up);
    }
  }
  return enhanceBinary(crop);
}

function enhanceBinary(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h);
  const p = data.data;
  for (let i = 0; i < p.length; i += 4) {
    const gray = p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114;
    const boosted = gray > 155 ? 255 : Math.max(0, gray - 22);
    p[i] = boosted;
    p[i + 1] = boosted;
    p[i + 2] = boosted;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error("toBlob failed"));
      },
      "image/png",
      0.92
    );
  });
}

function countFields(p: ReturnType<typeof toFlatParsedForApi>): number {
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

export type OcrProgressPhase =
  | "preparing"
  | "orientation"
  | "scanning_region"
  | "parsing"
  | "complete";

export type OcrProgress = { phase: OcrProgressPhase; label: string; region?: RegionId };

/**
 * Region-first OCR: pick 0° vs 90° on a downscaled canvas, OCR each check region once, merge text, parse with confidence.
 */
export function runLocalCheckOcr(
  file: File,
  opts?: {
    onProgress?: (p: OcrProgress) => void;
    onPhase?: (message: string) => void;
    timeoutMs?: number;
  }
): Promise<LocalOcrBestResult> {
  const run = ocrQueue.then(() => runLocalCheckOcrCore(file, opts));
  ocrQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function runLocalCheckOcrCore(
  file: File,
  opts?: {
    onProgress?: (p: OcrProgress) => void;
    onPhase?: (message: string) => void;
    timeoutMs?: number;
  }
): Promise<LocalOcrBestResult> {
  const timingsMs: Record<string, number> = {};
  const t0 = performance.now();
  const onP = opts?.onProgress;
  const onPhase = opts?.onPhase;
  const timeoutMs = opts?.timeoutMs ?? 180_000;

  const withTimeout = async <T,>(p: Promise<T>): Promise<T> => {
    if (timeoutMs <= 0) return p;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("On-device OCR timed out")), timeoutMs);
      p.then(
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
  };

  return withTimeout(
    (async () => {
      onP?.({ phase: "preparing", label: "Preparing image…" });
      onPhase?.("Preparing image…");

      const tPrep = performance.now();
      const worker = await getWorker();
      const { PSM } = await import("tesseract.js");

      let portraitLike = false;
      try {
        const bmp = await createImageBitmap(file);
        portraitLike = bmp.height > bmp.width * 1.08;
        bmp.close();
      } catch {
        portraitLike = false;
      }
      const candidates = portraitLike ? ([90, 0] as const) : ([0, 90] as const);

      let bestAngle = 0;
      let bestCanvas: HTMLCanvasElement | null = null;
      let bestScore = -1;

      onP?.({ phase: "orientation", label: "Detecting check orientation…" });
      onPhase?.("Detecting orientation…");

      const tRot = performance.now();
      const orientMaxEdge = 640;
      for (const deg of candidates) {
        const c = await blobToPngCanvas(file, deg, orientMaxEdge);
        const blob = await canvasToBlob(c);
        const { data } = await worker.recognize(blob);
        const len = String(data?.text || "").replace(/\s+/g, " ").length;
        const conf = Number(data?.confidence || 0);
        const score = len + conf * 0.2;
        if (score > bestScore) {
          bestScore = score;
          bestAngle = deg;
          bestCanvas = c;
        }
      }
      timingsMs.orientationMs = Math.round(performance.now() - tRot);

      if (!bestCanvas) {
        bestCanvas = await blobToPngCanvas(file, 0, 960);
        bestAngle = 0;
      } else {
        bestCanvas = await blobToPngCanvas(file, bestAngle, 960);
      }

      const w = bestCanvas.width;
      const h = bestCanvas.height;
      const croppedRegionText: Record<string, string> = {};
      const regionIds = Object.keys(CHECK_REGIONS) as RegionId[];

      for (const rid of regionIds) {
        const meta = CHECK_REGIONS[rid];
        const r = regionPixelRect(w, h, meta);
        onP?.({ phase: "scanning_region", label: `Scanning ${meta.label}…`, region: rid });
        onPhase?.(`Scanning ${meta.label}…`);
        const tR = performance.now();
        const proc = preprocessRegionCanvas(bestCanvas, r.x, r.y, r.w, r.h);
        await worker.setParameters({
          tessedit_pageseg_mode: rid === "micr" ? PSM.SINGLE_LINE : PSM.SINGLE_BLOCK
        });
        const b = await canvasToBlob(proc);
        const { data } = await worker.recognize(b);
        const txt = String(data?.text || "").trim();
        croppedRegionText[rid] = txt;
        timingsMs[`region_${rid}_ms`] = Math.round(performance.now() - tR);
      }

      timingsMs.preprocessTotalMs = Math.round(performance.now() - tPrep);

      const combined = regionIds.map((id) => `[${id}]\n${croppedRegionText[id] || ""}`).join("\n\n");
      onP?.({ phase: "parsing", label: "Parsing check fields…" });
      onPhase?.("Parsing check fields…");
      const tParse = performance.now();
      const detail = parseCheckOcrTextWithConfidence(combined, croppedRegionText);
      timingsMs.parseMs = Math.round(performance.now() - tParse);

      const flat = toFlatParsedForApi(detail);
      const fieldsDetected = countFields(flat);
      const score = fieldsDetected * 1000 + combined.length * 0.05;

      onP?.({ phase: "complete", label: "Complete" });
      onPhase?.("OCR complete");

      timingsMs.totalMs = Math.round(performance.now() - t0);

      return {
        text: combined,
        angle: bestAngle,
        parsed: flat,
        score,
        fieldsDetected,
        confidenceByField: detail.confidenceByField as Partial<Record<string, number>>,
        timingsMs,
        parseQuality: detail.parseQuality,
        warnings: detail.warnings,
        croppedRegionText
      };
    })()
  );
}

export { mergeCheckParsedPreferBetter, parseCheckOcrTextWithConfidence, toFlatParsedForApi };

/** Legacy name: returns flat fields only (for forms). */
export function parseCheckTextFromOcr(text: string) {
  return toFlatParsedForApi(parseCheckOcrTextWithConfidence(text));
}
