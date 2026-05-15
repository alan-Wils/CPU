"use client";

import type { CSSProperties } from "react";
import type { DymoLabelCalibrationSettings } from "@/lib/dymoLabelCalibration";
import {
  defaultDymoLabelCalibrationSettings,
  previewAspectRatioFromSettings,
  validateDymoLabelCalibrationSettings,
} from "@/lib/dymoLabelCalibration";

export type { DymoLabelCalibrationSettings };
export { defaultDymoLabelCalibrationSettings } from "@/lib/dymoLabelCalibration";

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

/**
 * Full HTML document for a hidden iframe (no inline script — parent calls print()).
 * Dedicated DYMO print layout: `@page` matches saved label size; transforms from calibration only.
 */
export function buildDymoExtractionBatchLabelPrintHtml(
  f: ExtractionBatchLabelFields,
  calibration?: DymoLabelCalibrationSettings,
): string {
  const s = resolveCalibration(calibration ?? defaultDymoLabelCalibrationSettings);
  const inner = `
<div class="dymo-label-sheet">
  <div class="dymo-label-stage">
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
`;

  const ty = `calc(${s.offsetY} + ${s.startOffsetY})`;
  const transform = `translate(${s.offsetX}, ${ty}) rotate(${cssNum(s.rotationDeg)}deg) scale(${cssNum(s.printScale)})`;

  return `<!DOCTYPE html>
<html lang="en" class="dymo-label-print-root"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Extraction batch label</title>
<style>
  /* --- DYMO extraction batch label print --- */
  @page {
    size: ${s.labelWidth} ${s.labelHeight};
    margin: 0;
  }
  :root {
    --dymo-pad-x: ${s.paddingLeftRight};
    --dymo-gap: ${s.textSpacing};
    --dymo-font-mul: ${cssNum(s.fontSizeMultiplier)};
  }
  * { box-sizing: border-box; }
  html.dymo-label-print-root {
    width: ${s.labelWidth};
    height: ${s.labelHeight};
    margin: 0;
    padding: 0;
    overflow: hidden;
  }
  body {
    margin: 0;
    padding: 0;
    width: ${s.labelWidth};
    height: ${s.labelHeight};
    max-width: ${s.labelWidth};
    max-height: ${s.labelHeight};
    overflow: hidden;
    font-family: system-ui, "Segoe UI", Roboto, Arial, sans-serif;
    background: #fff;
    page-break-after: avoid;
    break-after: avoid;
  }
  .dymo-label-sheet {
    width: ${s.labelWidth};
    height: ${s.labelHeight};
    margin: 0;
    padding: 0;
    position: relative;
    overflow: hidden;
    background: #fff;
  }
  .dymo-label-stage {
    margin: 0;
    padding: 0;
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    transform: ${transform};
  }
  .dymo-label-inner {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    justify-content: flex-start;
    gap: var(--dymo-gap);
    text-align: center;
    padding-left: var(--dymo-pad-x);
    padding-right: var(--dymo-pad-x);
    max-width: ${s.labelWidth};
  }
  .col {
    display: flex;
    flex-direction: column;
    align-items: center;
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
    html, body {
      background: #fff !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .dymo-label-sheet {
      page-break-inside: avoid;
      break-inside: avoid;
      page-break-after: avoid;
      break-after: avoid;
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

/**
 * Opens the print dialog via a hidden iframe sized to the calibrated label.
 * Pass saved calibration for production prints; pass draft calibration for test prints.
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
    "overflow:hidden",
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

type PreviewProps = {
  fields: ExtractionBatchLabelFields;
  /** Live calibration from the DYMO panel (draft) */
  calibration: DymoLabelCalibrationSettings;
  style?: CSSProperties;
};

/** Horizontal on-screen preview; mirrors print transforms and typography scale. */
export function ExtractionBatchLabelPreview({ fields, calibration, style }: PreviewProps) {
  const s = resolveCalibration(calibration);
  const aspect = previewAspectRatioFromSettings(s);
  const ty = `calc(${s.offsetY} + ${s.startOffsetY})`;

  const col: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-start",
    textAlign: "center",
    minWidth: 0,
    flex: "1 1 0",
  };

  const fmul = s.fontSizeMultiplier;

  return (
    <div
      style={{
        width: "min(520px, 94vw)",
        maxWidth: "100%",
        aspectRatio: aspect,
        padding: "clamp(10px, 2vw, 18px) clamp(12px, 2.5vw, 20px)",
        border: "1px solid rgba(148, 163, 184, 0.55)",
        borderRadius: 12,
        background:
          "linear-gradient(145deg, rgba(15, 23, 42, 0.92), rgba(30, 41, 59, 0.95))",
        color: "#e2e8f0",
        fontFamily: "system-ui, Segoe UI, Roboto, Arial, sans-serif",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
        ...style,
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "flex-start",
          minHeight: 0,
          width: "100%",
          background: "rgba(15, 23, 42, 0.35)",
          borderRadius: 8,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transformOrigin: "0 0",
            transform: `translate(${s.offsetX}, ${ty}) rotate(${s.rotationDeg}deg) scale(${s.printScale})`,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "flex-start",
              justifyContent: "flex-start",
              gap: s.textSpacing,
              textAlign: "center",
              paddingLeft: s.paddingLeftRight,
              paddingRight: s.paddingLeftRight,
              height: "100%",
              width: "100%",
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
                  fontSize: `calc(clamp(0.85rem, 2.8vw, 1.35rem) * ${fmul})`,
                  fontWeight: 700,
                  lineHeight: 1.08,
                  letterSpacing: "0.03em",
                  maxWidth: "100%",
                  wordBreak: "break-word",
                }}
              >
                {fields.marketCode}
              </div>
              <div
                style={{
                  fontSize: `calc(clamp(0.55rem, 1.5vw, 0.75rem) * ${fmul})`,
                  color: "#94a3b8",
                  wordBreak: "break-all",
                  marginTop: 6,
                  lineHeight: 1.12,
                  maxWidth: "100%",
                }}
              >
                {fields.batchId}
              </div>
            </div>
            <div style={{ ...col }}>
              <div
                style={{
                  fontSize: `calc(clamp(0.72rem, 2vw, 0.95rem) * ${fmul})`,
                  fontWeight: 600,
                  lineHeight: 1.12,
                  maxWidth: "100%",
                  wordBreak: "break-word",
                }}
              >
                {fields.productType}
              </div>
              <div
                style={{
                  fontSize: `calc(clamp(0.58rem, 1.7vw, 0.82rem) * ${fmul})`,
                  marginTop: 8,
                  lineHeight: 1.15,
                  color: "#cbd5e1",
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
  );
}
