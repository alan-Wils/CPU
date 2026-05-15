import { describe, expect, it } from "vitest";
import {
  coerceLegacyDymoCalibrationInput,
  defaultDymoLabelCalibrationSettings,
  mergeDymoLabelCalibration,
  parseCssLengthNumber,
  previewAspectRatioFromSettings,
  validateDymoLabelCalibrationSettings,
} from "./dymoLabelCalibration";

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
    if (r.ok) expect(r.value.labelWidth).toBe("2in");
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
  it("maps offsetX/offsetY to frame offsets", () => {
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
});

describe("parseCssLengthNumber", () => {
  it("parses positive lengths for aspect ratio", () => {
    expect(parseCssLengthNumber("2in")).toBe(2);
    expect(parseCssLengthNumber("")).toBe(null);
  });
});
