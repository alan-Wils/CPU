import { describe, expect, it } from "vitest";
import {
  approximateCssLengthToViewportPx,
  approximateDymoPrintHostSurfacePx,
  clampDymoLabelPrintCopies,
  coerceLegacyDymoCalibrationInput,
  defaultDymoLabelCalibrationSettings,
  DYMO_LABEL_PRINT_COPIES_MAX,
  mergeDymoLabelCalibration,
  pageSizeCssForDymoAtPage,
  parseCssLengthNumber,
  previewAspectRatioFromSettings,
  validateDymoLabelCalibrationSettings,
} from "./dymoLabelCalibration";

describe("clampDymoLabelPrintCopies", () => {
  it("clamps to 1–50", () => {
    expect(clampDymoLabelPrintCopies(0)).toBe(1);
    expect(clampDymoLabelPrintCopies(-3)).toBe(1);
    expect(clampDymoLabelPrintCopies(3.7)).toBe(3);
    expect(clampDymoLabelPrintCopies(999)).toBe(DYMO_LABEL_PRINT_COPIES_MAX);
    expect(clampDymoLabelPrintCopies("12")).toBe(12);
    expect(clampDymoLabelPrintCopies("nope")).toBe(1);
  });
});

describe("validateDymoLabelCalibrationSettings", () => {
  it("normalizes bare numeric frame offsets to px", () => {
    const r = validateDymoLabelCalibrationSettings({
      ...defaultDymoLabelCalibrationSettings,
      labelFrameOffsetX: "-18",
      labelFrameOffsetY: "-37",
      startOffsetY: "0",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.labelFrameOffsetX).toBe("-18px");
      expect(r.value.labelFrameOffsetY).toBe("-37px");
      expect(r.value.startOffsetY).toBe("0px");
      expect(r.value.contentOffsetX).toBe("0px");
      expect(r.value.contentOffsetY).toBe("0px");
    }
  });

  it("accepts defaults", () => {
    const r = validateDymoLabelCalibrationSettings(defaultDymoLabelCalibrationSettings);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.labelWidth).toBe("1in");
  });

  it("rejects invalid length strings", () => {
    const r = validateDymoLabelCalibrationSettings({
      ...defaultDymoLabelCalibrationSettings,
      labelWidth: "abc",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects invalid scale", () => {
    const r = validateDymoLabelCalibrationSettings({
      ...defaultDymoLabelCalibrationSettings,
      printScale: 0,
    });
    expect(r.ok).toBe(false);
  });
});

describe("coerceLegacyDymoCalibrationInput", () => {
  it("maps offsetX/offsetY to whole-label offsets", () => {
    const c = coerceLegacyDymoCalibrationInput({
      offsetX: "-12px",
      offsetY: "3mm",
    } as Record<string, unknown>);
    expect(c.labelFrameOffsetX).toBe("-12px");
    expect(c.labelFrameOffsetY).toBe("3mm");
    expect((c as Record<string, unknown>).offsetX).toBeUndefined();
  });
});

describe("mergeDymoLabelCalibration", () => {
  it("overrides partial fields", () => {
    const m = mergeDymoLabelCalibration(defaultDymoLabelCalibrationSettings, {
      labelFrameOffsetY: "-1mm",
    });
    expect(m.labelFrameOffsetY).toBe("-1mm");
    expect(m.labelWidth).toBe(defaultDymoLabelCalibrationSettings.labelWidth);
  });
});

describe("previewAspectRatioFromSettings", () => {
  it("returns width/height for inch lengths", () => {
    expect(
      previewAspectRatioFromSettings({
        ...defaultDymoLabelCalibrationSettings,
        labelWidth: "2in",
        labelHeight: "1in",
      }),
    ).toBe(2);
  });

  it("matches default 1in × 1.5in stock ratio", () => {
    expect(previewAspectRatioFromSettings(defaultDymoLabelCalibrationSettings)).toBeCloseTo(2 / 3, 6);
  });
});

describe("parseCssLengthNumber", () => {
  it("parses positive lengths for aspect ratio", () => {
    expect(parseCssLengthNumber("1in")).toBe(1);
    expect(parseCssLengthNumber("")).toBe(null);
  });
});

describe("pageSizeCssForDymoAtPage", () => {
  it("converts plain inch label dimensions to mm for @page (Chromium)", () => {
    expect(pageSizeCssForDymoAtPage("1in", "1.5in")).toBe("25.4mm 38.1mm");
  });

  it("falls back to raw lengths when mixing units", () => {
    expect(pageSizeCssForDymoAtPage("144px", "1.5in")).toBe("144px 1.5in");
  });
});

describe("approximateCssLengthToViewportPx", () => {
  it("converts inch widths to layout px (~96 DPI)", () => {
    expect(approximateCssLengthToViewportPx("1in")).toBe(96);
    expect(approximateCssLengthToViewportPx("1.5in")).toBe(144);
    expect(approximateCssLengthToViewportPx("2in")).toBe(192);
  });

  it("normalizes bare numbers as px via calibration rules", () => {
    expect(approximateCssLengthToViewportPx("100")).toBe(100);
  });
});

describe("approximateDymoPrintHostSurfacePx", () => {
  it("pads hidden print iframe moderately beyond label px for transform bleed", () => {
    const h = approximateDymoPrintHostSurfacePx("1in", "1.5in");
    expect(h.iframeWpx).toBeGreaterThanOrEqual(96 + 200);
    expect(h.iframeHpx).toBeGreaterThanOrEqual(144 + 200);
    expect(h.iframeWpx).toBeLessThanOrEqual(600);
    expect(h.iframeHpx).toBeLessThanOrEqual(700);
  });
});