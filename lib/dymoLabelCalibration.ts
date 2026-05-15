/**
 * DYMO LabelWriter calibration for extraction batch sticker printing (NexBatch).
 * Persisted under company config `extraction.dymoLabelCalibration` when API save succeeds;
 * localStorage fallback uses {@link localStorageKeyForDymoCalibration}.
 */

export type DymoLabelCalibrationSettings = {
  /** Physical label width for `@page` size and print iframe (CSS length, e.g. `1in`). */
  labelWidth: string;
  /** Physical label height (CSS length). */
  labelHeight: string;
  /**
   * Moves the **entire print job** horizontally: white sheet, frame, border, columns, and text together (print origin on X).
   */
  labelFrameOffsetX: string;
  /**
   * Moves the **entire print job** vertically from the page origin; combined with {@link startOffsetY} on the job transform (feed axis).
   */
  labelFrameOffsetY: string;
  /**
   * Fine horizontal shift of **inner** content only (inside the frame border).
   */
  contentOffsetX: string;
  /**
   * Fine vertical shift of **inner** content only (inside the frame).
   */
  contentOffsetY: string;
  /** Rotation in degrees (clockwise), applied to the whole print job (sheet + frame + text). */
  rotationDeg: number;
  /**
   * Multiplier applied to base font sizes (unitless, typically 0.75–1.25).
   * Does not change layout padding; use with printScale for overall shrink/grow.
   */
  fontSizeMultiplier: number;
  /**
   * Additional shift along the **label feed axis** (CSS length), combined with {@link labelFrameOffsetY} on the job transform.
   * Use negative values when the driver prints “too late” and content straddles the gap between die-cut labels.
   */
  startOffsetY: string;
  /** Horizontal padding inside the text columns (CSS length). */
  paddingLeftRight: string;
  /** Gap between the two columns / perceived text looseness (CSS length). */
  textSpacing: string;
  /** Uniform scale applied on `.dymo-label-content` only (inner content). */
  printScale: number;
};

export const DYMO_CALIBRATION_CONFIG_KEY = "dymoLabelCalibration" as const;

/**
 * Defaults for common 1″×1½″ die-cut extraction labels. Frame offsets stay neutral — print CSS auto-centers
 * the two-column template within the calibrated label width and height.
 */
export const defaultDymoLabelCalibrationSettings: DymoLabelCalibrationSettings = {
  labelWidth: "1in",
  labelHeight: "1.5in",
  labelFrameOffsetX: "0in",
  labelFrameOffsetY: "0in",
  contentOffsetX: "0px",
  contentOffsetY: "0px",
  rotationDeg: 0,
  fontSizeMultiplier: 1,
  startOffsetY: "0in",
  paddingLeftRight: "0.06in",
  textSpacing: "0.05in",
  printScale: 1,
};

const CSS_LENGTH_RE =
  /^[-+]?(?:\d*\.\d+|\d+)(?:in|cm|mm|pt|px)$/;

/** Plain signed number without unit → pixels (matches browser transform math when users enter `-18`). */
const BARE_NUMBER_LENGTH_RE = /^[-+]?(?:\d*\.\d+|\d+)$/;

function isValidCssLength(s: string): boolean {
  const t = String(s || "").trim();
  return t.length > 0 && CSS_LENGTH_RE.test(t);
}

/** Normalize calibration length fields for CSS (append `px` to bare numbers). */
export function normalizeDymoCalibrationCssLength(raw: string): string {
  const t = String(raw ?? "").trim();
  if (!t) return t;
  if (CSS_LENGTH_RE.test(t)) return t;
  if (BARE_NUMBER_LENGTH_RE.test(t)) return `${t}px`;
  return t;
}

export function normalizeDymoLabelCalibrationSettings(
  s: DymoLabelCalibrationSettings,
): DymoLabelCalibrationSettings {
  return {
    ...s,
    labelWidth: normalizeDymoCalibrationCssLength(s.labelWidth),
    labelHeight: normalizeDymoCalibrationCssLength(s.labelHeight),
    labelFrameOffsetX: normalizeDymoCalibrationCssLength(s.labelFrameOffsetX),
    labelFrameOffsetY: normalizeDymoCalibrationCssLength(s.labelFrameOffsetY),
    contentOffsetX: normalizeDymoCalibrationCssLength(s.contentOffsetX),
    contentOffsetY: normalizeDymoCalibrationCssLength(s.contentOffsetY),
    startOffsetY: normalizeDymoCalibrationCssLength(s.startOffsetY),
    paddingLeftRight: normalizeDymoCalibrationCssLength(s.paddingLeftRight),
    textSpacing: normalizeDymoCalibrationCssLength(s.textSpacing),
  };
}

/** Map legacy `offsetX` / `offsetY` from saved JSON onto whole-label job offsets before merge. */
export function coerceLegacyDymoCalibrationInput(
  input: Partial<DymoLabelCalibrationSettings> | DymoLabelCalibrationSettings,
): Partial<DymoLabelCalibrationSettings> {
  const src = input as Record<string, unknown>;
  const base: Partial<DymoLabelCalibrationSettings> = { ...(input as object) };
  delete (base as Record<string, unknown>).offsetX;
  delete (base as Record<string, unknown>).offsetY;

  if (typeof src.offsetX === "string" && base.labelFrameOffsetX === undefined) {
    base.labelFrameOffsetX = src.offsetX;
  }
  if (typeof src.offsetY === "string" && base.labelFrameOffsetY === undefined) {
    base.labelFrameOffsetY = src.offsetY;
  }
  return base;
}

export function mergeDymoLabelCalibration(
  base: DymoLabelCalibrationSettings,
  patch: Partial<DymoLabelCalibrationSettings> | null | undefined,
): DymoLabelCalibrationSettings {
  if (!patch || typeof patch !== "object") return { ...base };
  const p = coerceLegacyDymoCalibrationInput(patch);
  return {
    ...base,
    ...p,
    labelWidth:
      typeof p.labelWidth === "string" ? p.labelWidth : base.labelWidth,
    labelHeight:
      typeof p.labelHeight === "string" ? p.labelHeight : base.labelHeight,
    labelFrameOffsetX:
      typeof p.labelFrameOffsetX === "string"
        ? p.labelFrameOffsetX
        : base.labelFrameOffsetX,
    labelFrameOffsetY:
      typeof p.labelFrameOffsetY === "string"
        ? p.labelFrameOffsetY
        : base.labelFrameOffsetY,
    contentOffsetX:
      typeof p.contentOffsetX === "string"
        ? p.contentOffsetX
        : base.contentOffsetX,
    contentOffsetY:
      typeof p.contentOffsetY === "string"
        ? p.contentOffsetY
        : base.contentOffsetY,
    rotationDeg:
      typeof p.rotationDeg === "number" && Number.isFinite(p.rotationDeg)
        ? p.rotationDeg
        : base.rotationDeg,
    fontSizeMultiplier:
      typeof p.fontSizeMultiplier === "number" &&
      Number.isFinite(p.fontSizeMultiplier)
        ? p.fontSizeMultiplier
        : base.fontSizeMultiplier,
    startOffsetY:
      typeof p.startOffsetY === "string" ? p.startOffsetY : base.startOffsetY,
    paddingLeftRight:
      typeof p.paddingLeftRight === "string"
        ? p.paddingLeftRight
        : base.paddingLeftRight,
    textSpacing:
      typeof p.textSpacing === "string" ? p.textSpacing : base.textSpacing,
    printScale:
      typeof p.printScale === "number" && Number.isFinite(p.printScale)
        ? p.printScale
        : base.printScale,
  };
}

/** Pull partial calibration from merged `/api/config` payload (`extraction` bucket). */
export function extractDymoCalibrationFromCompanyConfig(
  cfg: unknown,
): Partial<DymoLabelCalibrationSettings> {
  if (!cfg || typeof cfg !== "object") return {};
  const ext = (cfg as Record<string, unknown>).extraction;
  if (!ext || typeof ext !== "object") return {};
  const raw = (ext as Record<string, unknown>)[DYMO_CALIBRATION_CONFIG_KEY];
  if (!raw || typeof raw !== "object") return {};
  return coerceLegacyDymoCalibrationInput(raw as Partial<DymoLabelCalibrationSettings>);
}

export type DymoCalibrationValidationResult =
  | { ok: true; value: DymoLabelCalibrationSettings }
  | { ok: false; errors: string[] };

export function validateDymoLabelCalibrationSettings(
  input: Partial<DymoLabelCalibrationSettings> | DymoLabelCalibrationSettings,
): DymoCalibrationValidationResult {
  const coerced = coerceLegacyDymoCalibrationInput(input);
  const merged = mergeDymoLabelCalibration(defaultDymoLabelCalibrationSettings, coerced);
  const normalized = normalizeDymoLabelCalibrationSettings(merged);
  const errors: string[] = [];

  for (const key of [
    "labelWidth",
    "labelHeight",
    "labelFrameOffsetX",
    "labelFrameOffsetY",
    "contentOffsetX",
    "contentOffsetY",
    "startOffsetY",
    "paddingLeftRight",
    "textSpacing",
  ] as const) {
    if (!isValidCssLength(normalized[key])) {
      errors.push(
        `${key} must be a CSS length (e.g. 1in, -12px, 3mm). Plain numbers like -18 are treated as px.`,
      );
    }
  }

  if (!(normalized.fontSizeMultiplier > 0 && normalized.fontSizeMultiplier <= 4)) {
    errors.push("fontSizeMultiplier must be greater than 0 and at most 4");
  }

  if (!(normalized.printScale > 0 && normalized.printScale <= 4)) {
    errors.push("printScale must be greater than 0 and at most 4");
  }

  if (!(Number.isFinite(normalized.rotationDeg) && Math.abs(normalized.rotationDeg) <= 360)) {
    errors.push("rotationDeg must be a finite number between -360 and 360");
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: normalized };
}

export function localStorageKeyForDymoCalibration(companyId: string): string {
  return `cpu_extraction_dymo_calibration_v1_${companyId || "no_company"}`;
}

export function readDymoCalibrationFromLocalStorage(
  companyId: string,
): Partial<DymoLabelCalibrationSettings> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(localStorageKeyForDymoCalibration(companyId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return coerceLegacyDymoCalibrationInput(
      parsed as Partial<DymoLabelCalibrationSettings>,
    );
  } catch {
    return null;
  }
}

export function writeDymoCalibrationToLocalStorage(
  companyId: string,
  value: DymoLabelCalibrationSettings,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      localStorageKeyForDymoCalibration(companyId),
      JSON.stringify(value),
    );
  } catch {
    /* ignore quota */
  }
}

/**
 * Server wins when it defines any calibration field; otherwise merge local backup into defaults.
 */
export function resolveDymoLabelCalibration(
  companyId: string,
  companyConfigPayload: unknown,
): DymoLabelCalibrationSettings {
  const fromServer = extractDymoCalibrationFromCompanyConfig(companyConfigPayload);
  const hasServer =
    fromServer &&
    typeof fromServer === "object" &&
    Object.keys(fromServer).length > 0;

  let merged = mergeDymoLabelCalibration(defaultDymoLabelCalibrationSettings, fromServer);

  if (!hasServer) {
    const local = readDymoCalibrationFromLocalStorage(companyId);
    merged = mergeDymoLabelCalibration(merged, local ?? {});
  }

  const v = validateDymoLabelCalibrationSettings(merged);
  return v.ok ? v.value : defaultDymoLabelCalibrationSettings;
}

/** Parse leading number from CSS lengths like `2in` for preview aspect ratio. */
export function parseCssLengthNumber(length: string): number | null {
  const m = String(length || "").trim().match(/^([-+]?(?:\d*\.\d+|\d+))/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const CSS_LEN_WITH_UNIT_RE =
  /^([-+]?(?:\d*\.\d+|\d+))(in|cm|mm|pt|px)$/;

/**
 * Pixel width for the print document's `<meta name="viewport" content="width=…">`.
 * `width=device-width` uses the full screen inside a tiny print iframe; Chromium then
 * shrink-to-fits the real `@page` label and the job looks centered on a wide white sheet
 * and can land between die-cuts. ~96 CSS px per inch.
 */
export function approximateCssLengthToViewportPx(raw: string): number {
  const s = normalizeDymoCalibrationCssLength(raw).trim();
  const m = s.match(CSS_LEN_WITH_UNIT_RE);
  const fallback = 512;
  if (!m) return fallback;
  const n = Math.abs(Number(m[1]));
  const u = m[2];
  if (!Number.isFinite(n) || n <= 0) return fallback;
  let px: number;
  switch (u) {
    case "px":
      px = n;
      break;
    case "in":
      px = n * 96;
      break;
    case "cm":
      px = (n * 96) / 2.54;
      break;
    case "mm":
      px = (n * 96) / 25.4;
      break;
    case "pt":
      px = (n * 96) / 72;
      break;
    default:
      return fallback;
  }
  return Math.round(Math.max(32, px));
}

/** Aspect ratio width/height for preview when both dimensions share the same unit kind. */
export function previewAspectRatioFromSettings(s: DymoLabelCalibrationSettings): number {
  const uw = parseCssLengthNumber(s.labelWidth);
  const uh = parseCssLengthNumber(s.labelHeight);
  if (uw != null && uh != null && uh > 0) return uw / uh;
  /** Fallback ratio for {@link defaultDymoLabelCalibrationSettings} — 1in × 1.5in. */
  return 2 / 3;
}
