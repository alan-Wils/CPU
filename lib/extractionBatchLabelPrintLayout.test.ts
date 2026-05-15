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

  it("sizes viewport meta from wider label axis (defaults use max(1in, 1.5in) → 144 css px)", () => {
    const html = buildDymoExtractionBatchLabelPrintHtml(fields, defaultDymoLabelCalibrationSettings);

    expect(html).not.toMatch(/viewport[^>]+device-width/i);
    expect(html).toContain('meta name="viewport" content="width=144');
    expect(html).toContain("size: 25.4mm 38.1mm");
  });

  it("@media print allows overflow visible so horizontal offsets are not clipped by sheet layers", () => {
    const html = buildDymoExtractionBatchLabelPrintHtml(fields);
    const printBlock =
      html.split("@media print")[1]?.split("</style>")[0] ?? "";
    expect(printBlock.length).toBeGreaterThan(20);
    expect(printBlock).toContain("overflow: visible !important");
    expect(printBlock).toContain(".dymo-label-printable-area");
  });

  it("uses full sticker width for text columns (top-aligned)", () => {
    const html = buildDymoExtractionBatchLabelPrintHtml(fields);
    const pa = html.match(/\.dymo-label-printable-area\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(pa).toContain("display: flex");
    expect(pa).toContain("justify-content: flex-start");
    expect(pa).toContain("align-items: stretch");
    const frame = html.match(/\.dymo-label-frame\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(frame).toContain("position: relative");
    expect(frame).not.toContain("left: 0");
    expect(frame).toContain("width: 100%");
    expect(frame).toContain("flex: 1 1 auto");
    expect(frame).toContain("flex-direction: column");
    const innerContent = html.match(/\.dymo-label-content\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(innerContent).toContain("width: 100%");
    expect(innerContent).toContain("flex-direction: column");
  });

  it("@media print anchors job absolutely to @page-sized body (not fixed viewport centering)", () => {
    const html = buildDymoExtractionBatchLabelPrintHtml(fields);
    const printBlock =
      html.split("@media print")[1]?.split("</style>")[0] ?? "";
    expect(printBlock).toContain(".dymo-label-job");
    expect(printBlock).toContain("position: absolute !important");
    expect(printBlock).toContain("top: 0 !important");
    expect(printBlock).toContain("left: 0 !important");
    expect(printBlock).toContain("right: 0 !important");
    expect(printBlock).toContain("bottom: 0 !important");
    expect(printBlock).toContain("width: 100% !important");
  });

  it("repeats @page size inside @media print (Chromium print stack)", () => {
    const html = buildDymoExtractionBatchLabelPrintHtml(fields, defaultDymoLabelCalibrationSettings);
    const printBlock =
      html.split("@media print")[1]?.split("</style>")[0] ?? "";
    expect(printBlock).toContain("@page");
    expect(printBlock).toContain("size: 25.4mm 38.1mm");
    expect(printBlock).toContain("margin: 0");
  });
});
