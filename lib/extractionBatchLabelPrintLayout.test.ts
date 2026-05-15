import { describe, expect, it } from "vitest";
import { buildDymoExtractionBatchLabelPrintHtml } from "@/components/extraction/ExtractionBatchLabelPrint";
import { defaultDymoLabelCalibrationSettings } from "@/lib/dymoLabelCalibration";

describe("DYMO extraction batch label print layout", () => {
  const fields = {
    batchId: "B1",
    marketCode: "M",
    productType: "P",
    sourcesLine: "S",
  };

  it("wraps sheet in job so whole-label calibration moves sheet + template together", () => {
    const html = buildDymoExtractionBatchLabelPrintHtml(fields, {
      ...defaultDymoLabelCalibrationSettings,
      labelFrameOffsetX: "4px",
      labelFrameOffsetY: "2px",
      startOffsetY: "1px",
      rotationDeg: 7,
      contentOffsetX: "3px",
      contentOffsetY: "5px",
      printScale: 0.9,
    });

    expect(html).toContain('class="dymo-label-job');
    expect(html.indexOf('class="dymo-label-job')).toBeLessThan(html.indexOf('class="dymo-label-sheet'));
    expect(html.indexOf('class="dymo-label-sheet')).toBeLessThan(
      html.indexOf('class="dymo-label-printable-area'),
    );
    expect(html.indexOf('class="dymo-label-printable-area')).toBeLessThan(
      html.indexOf('class="dymo-label-frame'),
    );
    expect(html.indexOf('class="dymo-label-frame')).toBeLessThan(
      html.indexOf('class="dymo-label-content'),
    );

    expect(html).toContain(
      "transform: translateX(4px) translateY(calc(2px + 1px)) rotate(7deg);",
    );

    expect(html).toContain(".dymo-label-frame");
    const frameCss = html.match(/\.dymo-label-frame\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(frameCss).not.toContain("translateX(4px)");
    expect(frameCss).not.toContain("transform:");

    const contentCss = html.match(/\.dymo-label-content\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(contentCss).toContain("transform:");
    expect(contentCss).toContain("translateX(3px)");
    expect(contentCss).toContain("translateY(5px)");
    expect(contentCss).toContain("scale(0.9)");
  });

  it("does not use device-width viewport (prevents Chromium shrink-fit centering on tiny @page)", () => {
    const html = buildDymoExtractionBatchLabelPrintHtml(fields, {
      ...defaultDymoLabelCalibrationSettings,
      labelWidth: "1.5in",
    });

    expect(html).not.toMatch(/viewport[^>]+device-width/i);
    expect(html).toContain('meta name="viewport" content="width=144');
  });
});
