"use client";

import type { CSSProperties } from "react";
import type { DymoLabelCalibrationSettings } from "@/lib/dymoLabelCalibration";
import {
  approximateCssLengthToViewportPx,
  approximateDymoPrintHostSurfacePx,
  defaultDymoLabelCalibrationSettings,
  pageSizeCssForDymoAtPage,
  validateDymoLabelCalibrationSettings,
  clampDymoLabelPrintCopies,
} from "@/lib/dymoLabelCalibration";

export type { DymoLabelCalibrationSettings };
export { defaultDymoLabelCalibrationSettings } from "@/lib/dymoLabelCalibration";

/**
 * Debug outlines: sheet (red), printable (orange), **job** (teal whole-label transform), **frame** (blue template border), **content** (violet inner).
 * Set to false once alignment is dialed in.
 */
export const DYMO_LABEL_LAYOUT_DEBUG = false;

export type ExtractionBatchLabelFields = {
  /**
   * Display extraction number: `acronym-date-run` (e.g. `GMO-051226-2`) parsed from stored `EXT-…` ids;
   * non-matching ids pass through unchanged.
   */
  newExtractionNumber: string;
  /** Strain names from extraction source rows (deduped, first-seen order), else saved blend/source line. */
  strain: string;
  product: string;
};

/**
 * Turns stored ids like `EXT-GMO0-051226` / `EXT-GMO0-051226-2` into label copy `GMO-051226-1` / `GMO-051226-2`:
 * drops the `EXT-` prefix, strips trailing zeros from the acronym token (so `GMO0` → `GMO`), and always appends an explicit run (default `1`).
 */
export function formatExtractionBatchLabelNumber(batchId: string): string {
  const id = String(batchId || "").trim();
  if (!id || id === "—") return id || "—";
  const m = id.match(/^EXT-([A-Za-z0-9]+)-(\d{6})(?:-(\d+))?$/i);
  if (!m) return id;
  const rawAcronym = m[1];
  const date = m[2];
  const run = m[3] && m[3].length > 0 ? m[3] : "1";
  const acronym =
    (rawAcronym.replace(/0+$/, "") || rawAcronym).toUpperCase();
  return `${acronym}-${date}-${run}`;
}

function collectStrainNamesFromSources(sources: Array<{ name?: string }>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of sources) {
    const n = String(row?.name || "").trim();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export function buildExtractionBatchLabelFields(batch: {
  id?: string;
  marketBatchCode?: string;
  productType?: string;
  name?: string;
  sourceBlendLabel?: string;
  source?: string;
  sources?: Array<{ name?: string }>;
}): ExtractionBatchLabelFields {
  const batchId = String(batch?.id || "").trim() || "—";
  const product = String(batch?.productType || batch?.name || "").trim() || "—";
  const newExtractionNumber = formatExtractionBatchLabelNumber(batchId);
  let strain = "—";
  if (Array.isArray(batch?.sources) && batch.sources.length > 0) {
    const names = collectStrainNamesFromSources(batch.sources);
    if (names.length > 0) {
      strain = names
        .map((p) => p.replace(/\b\w/g, (c) => c.toUpperCase()))
        .join(" · ");
    }
  }
  if (strain === "—") {
    strain =
      String(batch?.sourceBlendLabel || batch?.source || "").trim() || "—";
  }
  return { newExtractionNumber, strain, product };
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escape numeric calibration for inline CSS (transform, variables). */
function cssNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return String(n);
}

function resolveCalibration(
  calibration?: DymoLabelCalibrationSettings,
): DymoLabelCalibrationSettings {
  const v = validateDymoLabelCalibrationSettings(
    calibration ?? defaultDymoLabelCalibrationSettings,
  );
  return v.ok ? v.value : defaultDymoLabelCalibrationSettings;
}

/**
 * Extra rotation (deg) added to calibration {@link DymoLabelCalibrationSettings.rotationDeg} on the job transform.
 * Default 0 keeps CSS layout aligned with what you see in preview/print; use the calibration **Rotation** field for your die/stock.
 */
const DYMO_JOB_ROTATION_OFFSET_DEG = 0;

/** Print job: whole sheet + template position, rotation, and feed-axis Y (including {@link DymoLabelCalibrationSettings.startOffsetY}). */
function buildDymoLabelJobTransform(s: DymoLabelCalibrationSettings): string {
  const ty = `calc(${s.labelFrameOffsetY} + ${s.startOffsetY})`;
  const r = s.rotationDeg + DYMO_JOB_ROTATION_OFFSET_DEG;
  return [
    `translateX(${s.labelFrameOffsetX})`,
    `translateY(${ty})`,
    `rotate(${cssNum(r)}deg)`,
  ].join(" ");
}

/** Inner content: fine nudge + scale only (no rotation — rotation is on the job). */
function buildDymoLabelContentTransform(s: DymoLabelCalibrationSettings): string {
  return [
    `translateX(${s.contentOffsetX})`,
    `translateY(${s.contentOffsetY})`,
    `scale(${cssNum(s.printScale)})`,
  ].join(" ");
}

/**
 * Full HTML document for a hidden iframe (no inline script — parent calls print()).
 * Label copy is a single column: extraction number (acronym-date-run) → strain → product (see `.dymo-label-inner`), all bold.
 * @param copies Number of identical labels (each on its own @page); clamped {@link clampDymoLabelPrintCopies}.
 */
export function buildDymoExtractionBatchLabelPrintHtml(
  f: ExtractionBatchLabelFields,
  calibration?: DymoLabelCalibrationSettings,
  copies: number = 1,
): string {
  const s = resolveCalibration(calibration ?? defaultDymoLabelCalibrationSettings);
  const n = clampDymoLabelPrintCopies(copies);
  const dbg = DYMO_LABEL_LAYOUT_DEBUG ? " dymo-label-debug" : "";
  const originMarker = DYMO_LABEL_LAYOUT_DEBUG
    ? '<div class="dymo-label-origin-marker" aria-hidden="true"></div>'
    : "";
  const labelInner = `
<div class="dymo-label-job${dbg}">
  <div class="dymo-label-sheet${dbg}">
    <div class="dymo-label-printable-area${dbg}">
      ${originMarker}
      <div class="dymo-label-frame${dbg}">
        <div class="dymo-label-content${dbg}">
        <div class="dymo-label-inner">
          <div class="lbl-nex">${escapeHtml(f.newExtractionNumber)}</div>
          <div class="lbl-strain">${escapeHtml(f.strain)}</div>
          <div class="lbl-product">${escapeHtml(f.product)}</div>
        </div>
        </div>
      </div>
    </div>
  </div>
</div>
`;
  const bodyPages = Array.from(
    { length: n },
    () => `<div class="dymo-label-page">${labelInner}</div>`,
  ).join("\n");

  const jobTransform = buildDymoLabelJobTransform(s);
  const contentTransform = buildDymoLabelContentTransform(s);
  const vw = approximateCssLengthToViewportPx(s.labelWidth);
  const vhPx = approximateCssLengthToViewportPx(s.labelHeight);
  /* Wider viewport than narrow edge reduces Chromium shrinking the print layout toward the middle of a wrong-sized canvas */
  const viewportW = Math.max(vw, vhPx, 144);
  const pageSizeDecl = pageSizeCssForDymoAtPage(s.labelWidth, s.labelHeight);

  return `<!DOCTYPE html>
<html lang="en" class="dymo-label-print-root"><head><meta charset="utf-8"/><meta name="viewport" content="width=${viewportW}, initial-scale=1"/>
<title>Extraction batch label</title>
<style>
  /* --- DYMO: @page size uses mm translated from inch calibration so Chrome respects true sticker width; body uses user units + flex placement. --- */
  @page {
    size: ${pageSizeDecl};
    margin: 0;
  }
  :root {
    --label-width: ${s.labelWidth};
    --label-height: ${s.labelHeight};
    --dymo-pad-x: ${s.paddingLeftRight};
    --dymo-gap: ${s.textSpacing};
    --dymo-font-mul: ${cssNum(s.fontSizeMultiplier)};
  }
  * { box-sizing: border-box; }
  html.dymo-label-print-root {
    width: var(--label-width);
    height: auto;
    min-height: var(--label-height);
    margin: 0;
    padding: 0;
    overflow: visible;
  }
  body {
    position: relative;
    margin: 0;
    padding: 0;
    width: var(--label-width);
    min-height: var(--label-height);
    height: auto;
    max-width: var(--label-width);
    overflow: visible;
    font-family: system-ui, "Segoe UI", Roboto, Arial, sans-serif;
    background: #fff;
    page-break-after: avoid;
    break-after: avoid;
  }
  .dymo-label-page {
    position: relative;
    width: var(--label-width);
    height: var(--label-height);
    min-height: var(--label-height);
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    page-break-after: always;
    break-after: page;
  }
  .dymo-label-page:last-child {
    page-break-after: auto;
    break-after: auto;
  }
  .dymo-label-job {
    position: absolute;
    left: 0;
    top: 0;
    width: var(--label-width);
    height: var(--label-height);
    margin: 0;
    padding: 0;
    transform-origin: top left;
    transform: ${jobTransform};
    display: block;
  }
  .dymo-label-sheet {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 100%;
    margin: 0;
    padding: 0;
    overflow: visible;
    background: #fff;
    display: block;
  }
  .dymo-label-printable-area {
    position: absolute;
    inset: 0;
    margin: 0;
    padding: 0;
    overflow: visible;
    display: flex;
    justify-content: flex-start;
    align-items: stretch;
  }
  .dymo-label-origin-marker {
    position: absolute;
    left: 0;
    top: 0;
    width: 6px;
    height: 6px;
    margin: 0;
    padding: 0;
    background: #dc2626;
    border: 1px solid #f97316;
    border-radius: 1px;
    z-index: 6;
    pointer-events: none;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .dymo-label-frame {
    position: relative;
    margin: 0;
    padding: 0;
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    min-height: 0;
    min-width: 0;
    align-self: stretch;
  }
  .dymo-label-content {
    position: relative;
    margin: 0;
    padding: 0;
    transform-origin: top left;
    transform: ${contentTransform};
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    width: 100%;
    min-height: 0;
    min-width: 0;
    max-width: 100%;
  }
  .dymo-label-inner {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
    flex: 1 1 auto;
    width: 100%;
    min-width: 0;
    min-height: 0;
    gap: var(--dymo-gap);
    text-align: left;
    padding-left: var(--dymo-pad-x);
    padding-right: var(--dymo-pad-x);
    margin: 0;
    box-sizing: border-box;
  }
  .dymo-label-debug.dymo-label-job {
    box-shadow: inset 0 0 0 2px #14b8a6;
  }
  .dymo-label-debug.dymo-label-sheet {
    box-shadow: inset 0 0 0 2px #e11d48;
  }
  .dymo-label-debug.dymo-label-printable-area {
    box-shadow: inset 0 0 0 2px #ea580c;
  }
  .dymo-label-debug.dymo-label-frame {
    box-shadow: inset 0 0 0 2px #2563eb;
  }
  .dymo-label-debug.dymo-label-content {
    box-shadow: inset 0 0 0 2px #7c3aed;
  }
  .lbl-nex {
    font-size: calc(10.5pt * var(--dymo-font-mul));
    font-weight: 700;
    letter-spacing: 0.02em;
    line-height: 1.07;
    color: #0f172a;
    max-width: 100%;
    word-break: break-word;
  }
  .lbl-strain {
    font-size: calc(7.25pt * var(--dymo-font-mul));
    font-weight: 700;
    line-height: 1.1;
    color: #0f172a;
    max-width: 100%;
    word-break: break-word;
  }
  .lbl-product {
    font-size: calc(8.25pt * var(--dymo-font-mul));
    font-weight: 700;
    line-height: 1.1;
    color: #0f172a;
    max-width: 100%;
    word-break: break-word;
  }
  @media print {
    /* Repeat @page here: Chromium often applies size from the print media stack only when both are present. */
    @page {
      size: ${pageSizeDecl};
      margin: 0;
    }
    html.dymo-label-print-root, body {
      width: var(--label-width) !important;
      height: auto !important;
      min-height: var(--label-height) !important;
      max-width: var(--label-width) !important;
      max-height: none !important;
      margin: 0 !important;
      padding: 0 !important;
      background: #fff !important;
      overflow: visible !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    /*
     * position:fixed in Chromium print often centers or shrinks vs the chosen paper size; anchor the job to the
     * @page-sized body with absolute inset 0 instead.
     */
    .dymo-label-job {
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      width: 100% !important;
      height: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    .dymo-label-origin-marker {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .dymo-label-sheet {
      width: 100% !important;
      height: 100% !important;
      page-break-inside: avoid;
      break-inside: avoid;
      /* Whole-label / inner translateX spills past nominal box — let @page trim, don't pre-clip here. */
      overflow: visible !important;
    }
    .dymo-label-printable-area {
      overflow: visible !important;
      display: flex !important;
      justify-content: flex-start !important;
      align-items: stretch !important;
    }
  }
</style></head><body>${bodyPages}</body></html>`;
}

/** @deprecated Use {@link buildDymoExtractionBatchLabelPrintHtml} — alias keeps older imports working */
export function buildLabelPrintDocumentHtml(
  f: ExtractionBatchLabelFields,
  calibration?: DymoLabelCalibrationSettings,
  copies?: number,
): string {
  return buildDymoExtractionBatchLabelPrintHtml(f, calibration, copies);
}

export type OpenExtractionBatchLabelPrintOptions = {
  calibration: DymoLabelCalibrationSettings;
  /** Identical labels in one print job (one @page each); default 1. */
  copies?: number;
};

function openDymoLabelPrintViaHiddenIframe(
  html: string,
  calibration: DymoLabelCalibrationSettings,
): boolean {
  if (typeof document === "undefined") return false;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "DYMO extraction batch label print");
  const host = approximateDymoPrintHostSurfacePx(calibration.labelWidth, calibration.labelHeight);

  iframe.style.cssText = [
    "position:fixed",
    "left:-9999px",
    "top:0",
    `width:${host.iframeWpx}px`,
    `height:${host.iframeHpx}px`,
    "margin:0",
    "padding:0",
    "border:0",
    "opacity:0",
    "pointer-events:none",
    "z-index:-1",
    "overflow:visible",
  ].join(";");

  document.body.appendChild(iframe);

  const cw = iframe.contentWindow;
  const doc = iframe.contentDocument ?? cw?.document;
  if (!cw || !doc) {
    iframe.remove();
    return false;
  }

  doc.open();
  doc.write(html);
  doc.close();

  const remove = () => {
    iframe.remove();
  };

  const runPrint = () => {
    try {
      cw.focus();
      cw.print();
    } catch {
      remove();
      return;
    }
    cw.addEventListener("afterprint", remove, { once: true });
    setTimeout(remove, 3000);
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setTimeout(runPrint, 150);
    });
  });

  return true;
}

/**
 * Opens Chrome/Edge print from a narrow hidden iframe. DYMO/Windows drivers often ignore CSS @page in the preview —
 * Paper size must match stock in Print → More settings; we keep iframe small without extra popup windows.
 */
export function openExtractionBatchLabelPrintWindow(
  f: ExtractionBatchLabelFields,
  options?: Partial<OpenExtractionBatchLabelPrintOptions>,
): boolean {
  if (typeof document === "undefined") return false;

  const calibration = resolveCalibration(
    options?.calibration ?? defaultDymoLabelCalibrationSettings,
  );
  const copies = clampDymoLabelPrintCopies(options?.copies);
  const html = buildDymoExtractionBatchLabelPrintHtml(f, calibration, copies);
  return openDymoLabelPrintViaHiddenIframe(html, calibration);
}

type PreviewProps = {
  fields: ExtractionBatchLabelFields;
  /** Live calibration from the DYMO panel (draft) */
  calibration: DymoLabelCalibrationSettings;
  style?: CSSProperties;
};

/** On-screen preview: same DOM/CSS coordinate system as print; outer card may be centered on the page only. */
export function ExtractionBatchLabelPreview({ fields, calibration, style }: PreviewProps) {
  const s = resolveCalibration(calibration);
  const dbg = DYMO_LABEL_LAYOUT_DEBUG;
  const jobTransform = buildDymoLabelJobTransform(s);
  const contentTransform = buildDymoLabelContentTransform(s);
  const fmul = s.fontSizeMultiplier;

  const originMarker: CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    width: 6,
    height: 6,
    margin: 0,
    padding: 0,
    background: "#dc2626",
    border: "1px solid #f97316",
    borderRadius: 1,
    zIndex: 6,
    pointerEvents: "none",
    boxSizing: "border-box",
  };

  return (
    <div
      style={{
        width: "fit-content",
        maxWidth: "min(560px, 96vw)",
        margin: "0 auto",
        padding: "clamp(10px, 2vw, 18px)",
        border: "1px solid rgba(148, 163, 184, 0.55)",
        borderRadius: 12,
        background:
          "linear-gradient(145deg, rgba(15, 23, 42, 0.92), rgba(30, 41, 59, 0.95))",
        color: "#e2e8f0",
        fontFamily: "system-ui, Segoe UI, Roboto, Arial, sans-serif",
        overflow: "visible",
        display: "block",
        boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
        ...style,
      }}
    >
      {DYMO_LABEL_LAYOUT_DEBUG ? (
        <p
          style={{
            margin: "0 0 10px",
            fontSize: 11,
            color: "#94a3b8",
            lineHeight: 1.35,
            maxWidth: 420,
          }}
        >
          Outer white area = calibrated sticker ({s.labelWidth} × {s.labelHeight}). Lines top → bottom:{" "}
          <strong style={{ color: "#e2e8f0" }}>acronym-date-run → strain → product</strong> (all bold).{" "}
          <strong style={{ color: "#2dd4bf" }}>Teal</strong> = whole job ·{" "}
          <strong style={{ color: "#93c5fd" }}>Blue</strong> = frame ·{" "}
          <strong style={{ color: "#c4b5fd" }}>Violet</strong> = inner content.
        </p>
      ) : null}
      <div
        style={{
          position: "relative",
          width: s.labelWidth,
          height: s.labelHeight,
          margin: "0 auto",
          overflow: "visible",
          boxSizing: "border-box",
          background: "rgba(15, 23, 42, 0.4)",
        }}
      >
        <div
          className="dymo-label-job"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: s.labelWidth,
            height: s.labelHeight,
            margin: 0,
            padding: 0,
            transformOrigin: "top left",
            transform: jobTransform,
            display: "block",
            ...(dbg ? { boxShadow: "inset 0 0 0 2px #14b8a6" } : {}),
          }}
        >
          <div
            className="dymo-label-sheet"
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              minHeight: "100%",
              margin: 0,
              padding: 0,
              overflow: "visible",
              background: "#fff",
              display: "block",
              boxSizing: "border-box",
              ...(dbg ? { boxShadow: "inset 0 0 0 2px #e11d48" } : {}),
            }}
          >
            <div
              className="dymo-label-printable-area"
              style={{
                position: "absolute",
                inset: 0,
                margin: 0,
                padding: 0,
                overflow: "visible",
                display: "flex",
                justifyContent: "flex-start",
                alignItems: "stretch",
                boxSizing: "border-box",
                ...(dbg ? { boxShadow: "inset 0 0 0 2px #ea580c" } : {}),
              }}
            >
              {dbg ? <div style={originMarker} aria-hidden /> : null}
              <div
                className="dymo-label-frame"
                style={{
                  position: "relative",
                  margin: 0,
                  padding: 0,
                  flex: "1 1 auto",
                  alignSelf: "stretch",
                  display: "flex",
                  flexDirection: "column",
                  width: "100%",
                  height: "100%",
                  minWidth: 0,
                  minHeight: 0,
                  boxSizing: "border-box",
                  pointerEvents: "none",
                  ...(dbg ? { boxShadow: "inset 0 0 0 2px #2563eb" } : {}),
                }}
              >
                <div
                  className="dymo-label-content"
                  style={{
                    position: "relative",
                    margin: 0,
                    padding: 0,
                    transformOrigin: "top left",
                    transform: contentTransform,
                    display: "flex",
                    flexDirection: "column",
                    flex: "1 1 auto",
                    width: "100%",
                    minWidth: 0,
                    minHeight: 0,
                    maxWidth: "100%",
                    boxSizing: "border-box",
                    ...(dbg ? { boxShadow: "inset 0 0 0 2px #7c3aed" } : {}),
                  }}
                >
                  <div
                    className="dymo-label-inner"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "stretch",
                      justifyContent: "flex-start",
                      gap: s.textSpacing,
                      textAlign: "left",
                      flex: "1 1 auto",
                      width: "100%",
                      minWidth: 0,
                      minHeight: 0,
                      boxSizing: "border-box",
                      paddingLeft: s.paddingLeftRight,
                      paddingRight: s.paddingLeftRight,
                      margin: 0,
                      fontFamily: 'system-ui, "Segoe UI", Roboto, Arial, sans-serif',
                    }}
                  >
                    <div
                      style={{
                        fontSize: `calc(10.5pt * ${fmul})`,
                        fontWeight: 700,
                        lineHeight: 1.07,
                        letterSpacing: "0.02em",
                        maxWidth: "100%",
                        wordBreak: "break-word",
                        color: "#0f172a",
                      }}
                    >
                      {fields.newExtractionNumber}
                    </div>
                    <div
                      style={{
                        fontSize: `calc(7.25pt * ${fmul})`,
                        fontWeight: 700,
                        lineHeight: 1.1,
                        maxWidth: "100%",
                        wordBreak: "break-word",
                        color: "#0f172a",
                      }}
                    >
                      {fields.strain}
                    </div>
                    <div
                      style={{
                        fontSize: `calc(8.25pt * ${fmul})`,
                        fontWeight: 700,
                        lineHeight: 1.1,
                        maxWidth: "100%",
                        wordBreak: "break-word",
                        color: "#0f172a",
                      }}
                    >
                      {fields.product}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
