"use client";

import type { CSSProperties } from "react";
import type { DymoLabelCalibrationSettings } from "@/lib/dymoLabelCalibration";
import {
  approximateCssLengthToViewportPx,
  defaultDymoLabelCalibrationSettings,
  pageSizeCssForDymoAtPage,
  validateDymoLabelCalibrationSettings,
} from "@/lib/dymoLabelCalibration";

export type { DymoLabelCalibrationSettings };
export { defaultDymoLabelCalibrationSettings } from "@/lib/dymoLabelCalibration";

/**
 * Debug outlines: sheet (red), printable (orange), **job** (teal whole-label transform), **frame** (blue template border), **content** (violet inner).
 * Set to false once alignment is dialed in.
 */
export const DYMO_LABEL_LAYOUT_DEBUG = true;

export type ExtractionBatchLabelFields = {
  batchId: string;
  marketCode: string;
  productType: string;
  sourcesLine: string;
};

export function buildExtractionBatchLabelFields(batch: {
  id?: string;
  marketBatchCode?: string;
  productType?: string;
  name?: string;
  sourceBlendLabel?: string;
  source?: string;
}): ExtractionBatchLabelFields {
  const batchId = String(batch?.id || "").trim() || "—";
  const productType = String(batch?.productType || batch?.name || "").trim() || "—";
  const marketCode = String(batch?.marketBatchCode || "").trim() || batchId;
  const sourcesLine =
    String(batch?.sourceBlendLabel || batch?.source || "").trim() || "—";
  return { batchId, marketCode, productType, sourcesLine };
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

/** Print job: whole sheet + template position, rotation, and feed-axis Y (including {@link DymoLabelCalibrationSettings.startOffsetY}). */
function buildDymoLabelJobTransform(s: DymoLabelCalibrationSettings): string {
  const ty = `calc(${s.labelFrameOffsetY} + ${s.startOffsetY})`;
  return [
    `translateX(${s.labelFrameOffsetX})`,
    `translateY(${ty})`,
    `rotate(${cssNum(s.rotationDeg)}deg)`,
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
 * Dedicated DYMO print layout: `@page` matches saved label size; transforms from calibration only.
 */
export function buildDymoExtractionBatchLabelPrintHtml(
  f: ExtractionBatchLabelFields,
  calibration?: DymoLabelCalibrationSettings,
): string {
  const s = resolveCalibration(calibration ?? defaultDymoLabelCalibrationSettings);
  const dbg = DYMO_LABEL_LAYOUT_DEBUG ? " dymo-label-debug" : "";
  const originMarker = DYMO_LABEL_LAYOUT_DEBUG
    ? '<div class="dymo-label-origin-marker" aria-hidden="true"></div>'
    : "";
  const inner = `
<div class="dymo-label-job${dbg}">
  <div class="dymo-label-sheet${dbg}">
    <div class="dymo-label-printable-area${dbg}">
      ${originMarker}
      <div class="dymo-label-frame${dbg}">
        <div class="dymo-label-content${dbg}">
        <div class="dymo-label-inner">
        <div class="col left">
          <div class="code">${escapeHtml(f.marketCode)}</div>
          <div class="id">${escapeHtml(f.batchId)}</div>
        </div>
        <div class="col right">
          <div class="ptype">${escapeHtml(f.productType)}</div>
          <div class="src">${escapeHtml(f.sourcesLine)}</div>
        </div>
        </div>
        </div>
      </div>
    </div>
  </div>
</div>
`;

  const jobTransform = buildDymoLabelJobTransform(s);
  const contentTransform = buildDymoLabelContentTransform(s);
  const viewportW = approximateCssLengthToViewportPx(s.labelWidth);
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
    height: var(--label-height);
    margin: 0;
    padding: 0;
    overflow: visible;
  }
  body {
    position: relative;
    margin: 0;
    padding: 0;
    width: var(--label-width);
    height: var(--label-height);
    max-width: var(--label-width);
    max-height: var(--label-height);
    overflow: visible;
    font-family: system-ui, "Segoe UI", Roboto, Arial, sans-serif;
    background: #fff;
    page-break-after: avoid;
    break-after: avoid;
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
    width: var(--label-width);
    height: var(--label-height);
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
    justify-content: center;
    align-items: flex-start;
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
    flex: 0 0 auto;
    display: inline-block;
    width: max-content;
    max-width: var(--label-width);
  }
  .dymo-label-content {
    position: relative;
    margin: 0;
    padding: 0;
    transform-origin: top left;
    transform: ${contentTransform};
    display: block;
    width: max-content;
    max-width: var(--label-width);
  }
  .dymo-label-inner {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    justify-content: flex-start;
    gap: var(--dymo-gap);
    text-align: left;
    padding-left: var(--dymo-pad-x);
    padding-right: var(--dymo-pad-x);
    margin: 0;
  }
  .col {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
    min-width: 0;
    flex: 1 1 0;
  }
  .left {
    border-right: 0.5pt solid #bbb;
    padding-right: var(--dymo-gap);
  }
  .right {
    padding-left: 0;
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
  .code {
    font-size: calc(10.5pt * var(--dymo-font-mul));
    font-weight: 700;
    letter-spacing: 0.02em;
    line-height: 1.07;
    max-width: 100%;
    word-break: break-word;
  }
  .id {
    font-size: calc(6.25pt * var(--dymo-font-mul));
    color: #333;
    line-height: 1.1;
    margin-top: 0.04in;
    max-width: 100%;
    word-break: break-all;
  }
  .ptype {
    font-size: calc(8pt * var(--dymo-font-mul));
    font-weight: 600;
    line-height: 1.1;
    max-width: 100%;
    word-break: break-word;
  }
  .src {
    font-size: calc(6.25pt * var(--dymo-font-mul));
    margin-top: 0.04in;
    line-height: 1.1;
    color: #222;
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
      height: var(--label-height) !important;
      max-width: var(--label-width) !important;
      max-height: var(--label-height) !important;
      margin: 0 !important;
      padding: 0 !important;
      background: #fff !important;
      overflow: visible !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    /*
     * Chrome/Edge print preview often vertically centers absolutely positioned content when the user's
     * paper profile is taller than @page — fixed top-left ties the sheet to the real page/sticker origin.
     */
    .dymo-label-job {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: auto !important;
      bottom: auto !important;
      width: var(--label-width) !important;
      height: var(--label-height) !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    .dymo-label-origin-marker {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .dymo-label-sheet {
      page-break-inside: avoid;
      break-inside: avoid;
      page-break-after: avoid;
      break-after: avoid;
      /* Whole-label / inner translateX spills past nominal box — let @page trim, don't pre-clip here. */
      overflow: visible !important;
    }
    .dymo-label-printable-area {
      overflow: visible !important;
      display: flex !important;
      justify-content: center !important;
      align-items: flex-start !important;
    }
  }
</style></head><body>${inner}</body></html>`;
}

/** @deprecated Use {@link buildDymoExtractionBatchLabelPrintHtml} — alias keeps older imports working */
export function buildLabelPrintDocumentHtml(
  f: ExtractionBatchLabelFields,
  calibration?: DymoLabelCalibrationSettings,
): string {
  return buildDymoExtractionBatchLabelPrintHtml(f, calibration);
}

export type OpenExtractionBatchLabelPrintOptions = {
  calibration: DymoLabelCalibrationSettings;
};

function openDymoLabelPrintViaHiddenIframe(
  html: string,
  calibration: DymoLabelCalibrationSettings,
): boolean {
  if (typeof document === "undefined") return false;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "DYMO extraction batch label print");
  iframe.style.cssText = [
    "position:fixed",
    "left:-9999px",
    "top:0",
    `width:${calibration.labelWidth}`,
    `height:${calibration.labelHeight}`,
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
 * Opens Chrome/Edge print on a tiny top-level window so `@page { size: … }` is honored in preview.
 * Nested iframes often keep Letter/A4 in the preview even when `@page` is correct; iframe is only a fallback when popups are blocked.
 */
export function openExtractionBatchLabelPrintWindow(
  f: ExtractionBatchLabelFields,
  options?: Partial<OpenExtractionBatchLabelPrintOptions>,
): boolean {
  if (typeof document === "undefined") return false;

  const calibration = resolveCalibration(
    options?.calibration ?? defaultDymoLabelCalibrationSettings,
  );
  const html = buildDymoExtractionBatchLabelPrintHtml(f, calibration);

  const vw = approximateCssLengthToViewportPx(calibration.labelWidth);
  const vh = approximateCssLengthToViewportPx(calibration.labelHeight);
  const outerW = Math.min(Math.round(vw + 120), 720);
  const outerH = Math.min(Math.round(vh + 220), 900);
  const left =
    typeof screen !== "undefined"
      ? Math.max(0, Math.round((screen.availWidth - outerW) / 2))
      : 80;
  const top =
    typeof screen !== "undefined"
      ? Math.max(0, Math.round((screen.availHeight - outerH) / 2))
      : 80;

  const features = `popup=yes,width=${outerW},height=${outerH},left=${left},top=${top}`;
  const popup =
    typeof window !== "undefined"
      ? window.open("about:blank", "cpu_dymo_label_print", features)
      : null;

  if (!popup) {
    return openDymoLabelPrintViaHiddenIframe(html, calibration);
  }

  try {
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
  } catch {
    popup.close();
    return openDymoLabelPrintViaHiddenIframe(html, calibration);
  }

  const schedulePrint = () => {
    try {
      popup.focus();
      popup.print();
    } catch {
      try {
        popup.close();
      } catch {
        /* ignore */
      }
      return;
    }
    const cleanup = () => {
      try {
        popup.close();
      } catch {
        /* ignore */
      }
    };
    popup.addEventListener("afterprint", cleanup, { once: true });
    setTimeout(cleanup, 5000);
  };

  const start = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(schedulePrint, 150);
      });
    });
  };

  if (popup.document.readyState === "complete") {
    start();
  } else {
    popup.addEventListener("load", start, { once: true });
  }

  return true;
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

  const col: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    justifyContent: "flex-start",
    textAlign: "left",
    minWidth: 0,
    flex: "1 1 0",
  };

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
          Outer box = one physical sticker ({s.labelWidth} × {s.labelHeight}). Copy is pinned to the{" "}
          <strong style={{ color: "#e2e8f0" }}>top</strong> edge and{" "}
          <strong style={{ color: "#e2e8f0" }}>centered left–right</strong> so it stays on a single die-cut (not
          straddling the gap between two). Grey border does not clip before the printer/@page boundary.{" "}
          <strong style={{ color: "#2dd4bf" }}>Teal</strong> = whole job (offsets + rotation + start).{" "}
          <strong style={{ color: "#93c5fd" }}>Blue</strong> = template frame.{" "}
          <strong style={{ color: "#c4b5fd" }}>Violet</strong> = inner content (fine shift + scale).
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
              width: s.labelWidth,
              height: s.labelHeight,
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
                justifyContent: "center",
                alignItems: "flex-start",
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
                  flex: "0 0 auto",
                  display: "inline-block",
                  width: "max-content",
                  maxWidth: s.labelWidth,
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
                    display: "block",
                    width: "max-content",
                    maxWidth: s.labelWidth,
                    boxSizing: "border-box",
                    ...(dbg ? { boxShadow: "inset 0 0 0 2px #7c3aed" } : {}),
                  }}
                >
                  <div
                    className="dymo-label-inner"
                    style={{
                      display: "flex",
                      flexDirection: "row",
                      alignItems: "flex-start",
                      justifyContent: "flex-start",
                      gap: s.textSpacing,
                      textAlign: "left",
                      paddingLeft: s.paddingLeftRight,
                      paddingRight: s.paddingLeftRight,
                      margin: 0,
                      fontFamily: 'system-ui, "Segoe UI", Roboto, Arial, sans-serif',
                    }}
                  >
                    <div
                      style={{
                        ...col,
                        borderRight: "1px solid rgba(148, 163, 184, 0.35)",
                        paddingRight: s.textSpacing,
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
                        {fields.marketCode}
                      </div>
                      <div
                        style={{
                          fontSize: `calc(6.25pt * ${fmul})`,
                          color: "#334155",
                          wordBreak: "break-all",
                          marginTop: "0.04in",
                          lineHeight: 1.1,
                          maxWidth: "100%",
                        }}
                      >
                        {fields.batchId}
                      </div>
                    </div>
                    <div style={{ ...col }}>
                      <div
                        style={{
                          fontSize: `calc(8pt * ${fmul})`,
                          fontWeight: 600,
                          lineHeight: 1.1,
                          maxWidth: "100%",
                          wordBreak: "break-word",
                          color: "#0f172a",
                        }}
                      >
                        {fields.productType}
                      </div>
                      <div
                        style={{
                          fontSize: `calc(6.25pt * ${fmul})`,
                          marginTop: "0.04in",
                          lineHeight: 1.1,
                          color: "#222",
                          maxWidth: "100%",
                          wordBreak: "break-word",
                        }}
                      >
                        {fields.sourcesLine}
                      </div>
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
