import { describe, expect, it } from "vitest";
import {
  buildDymoExtractionBatchLabelPrintHtml,
  buildExtractionBatchLabelFields,
  formatExtractionBatchLabelNumber,
} from "@/components/extraction/ExtractionBatchLabelPrint";
import { defaultDymoLabelCalibrationSettings } from "@/lib/dymoLabelCalibration";

describe("DYMO extraction batch label print layout", () => {
  const fields = {
    marketBatchCode: "GMO.051226",
    strain: "T",
    product: "P",
    cultivationSourceLine: "",
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

  it("formatExtractionBatchLabelNumber parses EXT ids into acronym-date-run", () => {
    expect(formatExtractionBatchLabelNumber("EXT-GMO0-051226")).toBe("GMO-051226-1");
    expect(formatExtractionBatchLabelNumber("EXT-GMO0-051226-2")).toBe("GMO-051226-2");
    expect(formatExtractionBatchLabelNumber("ext-gmo0-051226-10")).toBe("GMO-051226-10");
    expect(formatExtractionBatchLabelNumber("EXT-MIX-010126")).toBe("MIX-010126-1");
  });

  it("formatExtractionBatchLabelNumber leaves non-EXT ids unchanged", () => {
    expect(formatExtractionBatchLabelNumber("EXT-1")).toBe("EXT-1");
    expect(formatExtractionBatchLabelNumber("")).toBe("—");
  });

  it("lays out market code, strain, product, then optional cultivation footer", () => {
    const withSource = buildDymoExtractionBatchLabelPrintHtml({
      ...fields,
      cultivationSourceLine: "GMO.051226",
    });
    const iMarket = withSource.indexOf('<div class="lbl-market">');
    const iStrain = withSource.indexOf('<div class="lbl-strain">');
    const iProduct = withSource.indexOf('<div class="lbl-product">');
    const iCult = withSource.indexOf('<div class="lbl-cultivation">');
    expect(iMarket).toBeGreaterThan(0);
    expect(iMarket).toBeLessThan(iStrain);
    expect(iStrain).toBeLessThan(iProduct);
    expect(iProduct).toBeLessThan(iCult);
  });

  it("buildExtractionBatchLabelFields uses market code, strain from sources, product", () => {
    expect(
      buildExtractionBatchLabelFields({
        id: "EXT-GMO0-010126",
        marketBatchCode: "GMO.010126",
        productType: "Live Resin",
        sources: [{ name: "blue dream" }, { name: "gelato" }],
      }),
    ).toEqual({
      marketBatchCode: "GMO.010126",
      strain: "Blue Dream · Gelato",
      product: "Live Resin",
      cultivationSourceLine: "",
    });
  });

  it("buildExtractionBatchLabelFields falls back strain to blend line and market code from EXT id", () => {
    expect(
      buildExtractionBatchLabelFields({
        id: "EXT-GMO0-051226",
        productType: "Badder",
        sourceBlendLabel: "Blend A",
      }),
    ).toEqual({
      marketBatchCode: "GMO.051226",
      strain: "Blend A",
      product: "Badder",
      cultivationSourceLine: "",
    });
  });

  it("buildExtractionBatchLabelFields includes cultivation source footer when resolved", () => {
    expect(
      buildExtractionBatchLabelFields(
        {
          id: "EXT-GMO0-051226",
          marketBatchCode: "GMO.051226",
          sources: [{ sourceId: "ff-1" }],
        },
        () => ({ source: "GMO.051226" }),
      ).cultivationSourceLine,
    ).toBe("GMO.051226");
  });

  it("label line classes use bold for main lines and lighter cultivation footer", () => {
    const html = buildDymoExtractionBatchLabelPrintHtml(fields);
    expect(html).toMatch(/\.lbl-market\s*\{[^}]*font-weight:\s*700/s);
    expect(html).toMatch(/\.lbl-strain\s*\{[^}]*font-weight:\s*700/s);
    expect(html).toMatch(/\.lbl-product\s*\{[^}]*font-weight:\s*700/s);
    expect(html).toMatch(/\.lbl-cultivation\s*\{[^}]*font-weight:\s*500/s);
  });

  it("uses full sticker width with inner column and line gap", () => {
    const html = buildDymoExtractionBatchLabelPrintHtml(fields);
    const pa = html.match(/\.dymo-label-printable-area\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(pa).toContain("display: flex");
    expect(pa).toContain("justify-content: flex-start");
    expect(pa).toContain("align-items: stretch");
    const inner = html.match(/\.dymo-label-inner\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(inner).toContain("flex-direction: column");
    expect(inner).toContain("gap: var(--dymo-gap)");
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

  it("emits one .dymo-label-page per copy", () => {
    const html = buildDymoExtractionBatchLabelPrintHtml(fields, defaultDymoLabelCalibrationSettings, 4);
    expect(html.match(/class="dymo-label-page"/g)?.length).toBe(4);
  });

  it("defaults to one page when copies omitted", () => {
    const html = buildDymoExtractionBatchLabelPrintHtml(fields);
    expect(html.match(/class="dymo-label-page"/g)?.length).toBe(1);
  });
});
