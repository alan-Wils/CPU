export type ImageQualityFailReason = "blur" | "dark" | "tilt";

export type ImageQualityResult =
  | { ok: true; blurScore: number; brightness: number; tiltRatio: number }
  | { ok: false; reason: ImageQualityFailReason; detail: string; blurScore: number; brightness: number; tiltRatio: number };

/**
 * Heuristic quality gate before expensive OCR.
 * blurScore: higher = sharper (Laplacian variance on grayscale, scaled).
 */
export function assessImageQualityFromCanvas(canvas: HTMLCanvasElement): ImageQualityResult {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { ok: false, reason: "blur", detail: "Canvas unavailable", blurScore: 0, brightness: 0, tiltRatio: 1 };
  }
  const w = canvas.width;
  const h = canvas.height;
  if (w < 40 || h < 40) {
    return { ok: false, reason: "blur", detail: "Image too small", blurScore: 0, brightness: 0, tiltRatio: 1 };
  }

  const step = Math.max(1, Math.floor(Math.min(w, h) / 200));
  const small = document.createElement("canvas");
  small.width = Math.floor(w / step);
  small.height = Math.floor(h / step);
  const sctx = small.getContext("2d");
  if (!sctx) {
    return { ok: false, reason: "blur", detail: "Cannot read pixels", blurScore: 0, brightness: 0, tiltRatio: 1 };
  }
  sctx.drawImage(canvas, 0, 0, small.width, small.height);
  const img = sctx.getImageData(0, 0, small.width, small.height);
  const d = img.data;
  const sw = small.width;
  const sh = small.height;

  let sumL = 0;
  let n = 0;
  const gray = (ix: number, iy: number) => {
    const i = (iy * sw + ix) * 4;
    return d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  };

  for (let y = 1; y < sh - 1; y += 2) {
    for (let x = 1; x < sw - 1; x += 2) {
      sumL += gray(x, y);
      n++;
    }
  }
  const brightness = n ? sumL / n / 255 : 0;

  let lapVar = 0;
  let lapMean = 0;
  let ln = 0;
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const c = gray(x, y);
      const lap = 4 * c - gray(x - 1, y) - gray(x + 1, y) - gray(x, y - 1) - gray(x, y + 1);
      lapMean += lap;
      ln++;
    }
  }
  lapMean /= Math.max(1, ln);
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const c = gray(x, y);
      const lap = 4 * c - gray(x - 1, y) - gray(x + 1, y) - gray(x, y - 1) - gray(x, y + 1);
      lapVar += (lap - lapMean) * (lap - lapMean);
    }
  }
  lapVar /= Math.max(1, ln);
  const blurScore = lapVar / 500;

  let hGrad = 0;
  let vGrad = 0;
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      hGrad += Math.abs(gray(x + 1, y) - gray(x - 1, y));
      vGrad += Math.abs(gray(x, y + 1) - gray(x, y - 1));
    }
  }
  const tiltRatio = vGrad > 0 ? hGrad / vGrad : 99;

  if (brightness < 0.12) {
    return {
      ok: false,
      reason: "dark",
      detail: "Image looks too dark — add light or move closer.",
      blurScore,
      brightness,
      tiltRatio
    };
  }
  if (blurScore < 0.35) {
    return {
      ok: false,
      reason: "blur",
      detail: "Image looks blurry — hold the phone steady and tap to focus.",
      blurScore,
      brightness,
      tiltRatio
    };
  }
  if (tiltRatio < 0.55) {
    return {
      ok: false,
      reason: "tilt",
      detail: "Check may be rotated — align the long edge horizontally.",
      blurScore,
      brightness,
      tiltRatio
    };
  }

  return { ok: true, blurScore, brightness, tiltRatio };
}
