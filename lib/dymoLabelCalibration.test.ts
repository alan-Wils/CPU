import { describe, expect, it } from "vitest";
import {
  defaultDymoLabelCalibrationSettings,
  mergeDymoLabelCalibration,
  parseCssLengthNumber,
  previewAspectRatioFromSettings,
  validateDymoLabelCalibrationSettings,
} from "./dymoLabelCalibration";

describe("validateDymoLabelCalibrationSettings", () => {
  it("normalizes bare numeric offsets to px", () => {
    const r = validateDymoLabelCalibrationSettings({
      ...defaultDymoLabelCalibrationSettings,
      offsetX: "-18",
      offsetY: "-37",
      startOffsetY: "0",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.offsetX).toBe("-18px");
      expect(r.value.offsetY).toBe("-37px");
      expect(r.value.startOffsetY).toBe("0px");
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

describe("mergeDymoLabelCalibration", () => {
  it("overrides partial fields", () => {
    const m = mergeDymoLabelCalibration(defaultDymoLabelCalibrationSettings, {
      offsetY: "-1mm",
    });
    expect(m.offsetY).toBe("-1mm");
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
