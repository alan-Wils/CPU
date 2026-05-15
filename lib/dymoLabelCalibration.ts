/**
 * DYMO LabelWriter calibration for extraction batch sticker printing (NexBatch).
 * Persisted under company config `extraction.dymoLabelCalibration` when API save succeeds;
 * localStorage fallback uses {@link localStorageKeyForDymoCalibration}.
 */

export type DymoLabelCalibrationSettings = {
  /** Physical label width for `@page` size and print iframe (CSS length, e.g. `2in`). */
  labelWidth: string;
  /** Physical label height (CSS length). */
  labelHeight: string;
  /**
   * Horizontal nudge of the printed block from the **left edge** of the sticker (CSS length).
   */
  offsetX: string;
  /**
   * Vertical nudge from the **top edge** of the sticker (CSS length).
   */
  offsetY: string;
  /** Rotation in degrees (clockwise). Use 0 for horizontal layout on wide labels. */
  rotationDeg: number;
  /**
   * Multiplier applied to base font sizes (unitless, typically 0.75–1.25).
   * Does not change layout padding; use with printScale for overall shrink/grow.
   */
  fontSizeMultiplier: number;
  /**
   * Additional shift along the **label feed axis** (CSS length), after {@link offsetY}.
   * Use negative values when the driver prints “too late” and content straddles the gap between die-cut labels.
   */
  startOffsetY: string;
  /** Horizontal padding inside the text columns (CSS length). */
  paddingLeftRight: string;
  /** Gap between the two columns / perceived text looseness (CSS length). */
  textSpacing: string;
  /** Uniform scale applied with CSS transform (0.5–2 typical). */
  printScale: number;
};

export const DYMO_CALIBRATION_CONFIG_KEY = "dymoLabelCalibration" as const;

/** Defaults tuned for small horizontal tag-style stock and earlier vertical placement on the roll. */
export const defaultDymoLabelCalibrationSettings: DymoLabelCalibrationSettings = {
  labelWidth: "2in",
  labelHeight: "1in",
  offsetX: "0in",
  offsetY: "-0.05in",
  rotationDeg: 0,
  fontSizeMultiplier: 1,
  /** Negative pulls content toward the leading edge of the detected label */
  startOffsetY: "-0.18in",
  paddingLeftRight: "0.06in",
  textSpacing: "0.05in",
  printScale: 1,
};

const CSS_LENGTH_RE =
  /^[-+]?(?:\d*\.\d+|\d+)(?:in|cm|mm|pt|px)$/;

function isValidCssLength(s: string): boolean {
  const t = String(s || "").trim();
  return t.length > 0 && CSS_LENGTH_RE.test(t);
}

export function mergeDymoLabelCalibration(
  base: DymoLabelCalibrationSettings,
  patch: Partial<DymoLabelCalibrationSettings> | null | undefined,
): DymoLabelCalibrationSettings {
  if (!patch || typeof patch !== "object") return { ...base };
  return {
    ...base,
    ...patch,
    labelWidth:
      typeof patch.labelWidth === "string" ? patch.labelWidth : base.labelWidth,
    labelHeight:
      typeof patch.labelHeight === "string" ? patch.labelHeight : base.labelHeight,
    offsetX: typeof patch.offsetX === "string" ? patch.offsetX : base.offsetX,
    offsetY: typeof patch.offsetY === "string" ? patch.offsetY : base.offsetY,
    rotationDeg:
      typeof patch.rotationDeg === "number" && Number.isFinite(patch.rotationDeg)
        ? patch.rotationDeg
        : base.rotationDeg,
    fontSizeMultiplier:
      typeof patch.fontSizeMultiplier === "number" &&
      Number.isFinite(patch.fontSizeMultiplier)
        ? patch.fontSizeMultiplier
        : base.fontSizeMultiplier,
    startOffsetY:
      typeof patch.startOffsetY === "string" ? patch.startOffsetY : base.startOffsetY,
    paddingLeftRight:
      typeof patch.paddingLeftRight === "string"
        ? patch.paddingLeftRight
        : base.paddingLeftRight,
    textSpacing:
      typeof patch.textSpacing === "string" ? patch.textSpacing : base.textSpacing,
    printScale:
      typeof patch.printScale === "number" && Number.isFinite(patch.printScale)
        ? patch.printScale
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
  return raw as Partial<DymoLabelCalibrationSettings>;
}

export type DymoCalibrationValidationResult =
  | { ok: true; value: DymoLabelCalibrationSettings }
  | { ok: false; errors: string[] };

export function validateDymoLabelCalibrationSettings(
  input: Partial<DymoLabelCalibrationSettings> | DymoLabelCalibrationSettings,
): DymoCalibrationValidationResult {
  const merged = mergeDymoLabelCalibration(defaultDymoLabelCalibrationSettings, input);
  const errors: string[] = [];

  for (const key of [
    "labelWidth",
    "labelHeight",
    "offsetX",
    "offsetY",
    "startOffsetY",
    "paddingLeftRight",
    "textSpacing",
  ] as const) {
    if (!isValidCssLength(merged[key])) {
      errors.push(`${key} must be a CSS length like 1in, 2mm, or -0.12in`);
    }
  }

  if (!(merged.fontSizeMultiplier > 0 && merged.fontSizeMultiplier <= 4)) {
    errors.push("fontSizeMultiplier must be greater than 0 and at most 4");
  }

  if (!(merged.printScale > 0 && merged.printScale <= 4)) {
    errors.push("printScale must be greater than 0 and at most 4");
  }

  if (!(Number.isFinite(merged.rotationDeg) && Math.abs(merged.rotationDeg) <= 360)) {
    errors.push("rotationDeg must be a finite number between -360 and 360");
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: merged };
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
    return parsed as Partial<DymoLabelCalibrationSettings>;
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

/** Aspect ratio width/height for preview when both dimensions share the same unit kind. */
export function previewAspectRatioFromSettings(s: DymoLabelCalibrationSettings): number {
  const uw = parseCssLengthNumber(s.labelWidth);
  const uh = parseCssLengthNumber(s.labelHeight);
  if (uw != null && uh != null && uh > 0) return uw / uh;
  return 2;
}
