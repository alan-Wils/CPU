"use client";

import type { CSSProperties } from "react";

/**
 * Printed page size — must match the label selected in the OS/DYMO dialog (width × height).
 * Portrait matches common die-cut strips fed with the long edge along the roll.
 */
const LABEL_PRINT_W = "1in";
const LABEL_PRINT_H = "1.5in";

/** Landscape copy block (two columns); rotated to fit portrait label — keeps text sideways on the strip */
const LABEL_CONTENT_W = "1.5in";
const LABEL_CONTENT_H = "1in";

/** Degrees; flip sign if copy reads upside-down on your printer/stock */
const LABEL_ROTATE_DEG = -90;

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

/** Full HTML document for a hidden iframe (no inline script — parent calls print()). */
function buildLabelPrintDocumentHtml(f: ExtractionBatchLabelFields): string {
  const inner = `
<div class="sheet">
  <div class="spin">
    <div class="inner">
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

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Extraction batch label</title>
<style>
  /* Exactly one physical label; zero margins avoids Chrome counting a 2nd sheet */
  @page {
    size: ${LABEL_PRINT_W} ${LABEL_PRINT_H};
    margin: 0;
  }
  * { box-sizing: border-box; }
  html {
    width: ${LABEL_PRINT_W};
    height: ${LABEL_PRINT_H};
    margin: 0;
    padding: 0;
    overflow: visible;
  }
  body {
    margin: 0;
    padding: 0;
    width: ${LABEL_PRINT_W};
    height: ${LABEL_PRINT_H};
    max-width: ${LABEL_PRINT_W};
    max-height: ${LABEL_PRINT_H};
    overflow: visible;
    font-family: system-ui, "Segoe UI", Roboto, Arial, sans-serif;
    background: #fff;
    page-break-after: avoid;
    break-after: avoid;
  }
  .sheet {
    width: ${LABEL_PRINT_W};
    height: ${LABEL_PRINT_H};
    max-width: ${LABEL_PRINT_W};
    max-height: ${LABEL_PRINT_H};
    margin: 0;
    padding: 0;
    background: #fff;
    position: relative;
    overflow: visible;
  }
  .spin {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: visible;
  }
  .inner {
    flex-shrink: 0;
    width: ${LABEL_CONTENT_W};
    height: ${LABEL_CONTENT_H};
    display: flex;
    flex-direction: row;
    align-items: stretch;
    justify-content: center;
    gap: 0.05in;
    text-align: center;
    transform: rotate(${LABEL_ROTATE_DEG}deg);
    transform-origin: center center;
  }
  .col {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-width: 0;
    flex: 1 1 0;
    height: 100%;
  }
  .left {
    border-right: 0.5pt solid #bbb;
    padding-right: 0.06in;
  }
  .right {
    padding-left: 0.04in;
  }
  .code {
    font-size: 10.5pt;
    font-weight: 700;
    letter-spacing: 0.02em;
    line-height: 1.07;
    max-width: 100%;
    word-break: break-word;
  }
  .id {
    font-size: 6.25pt;
    color: #333;
    line-height: 1.1;
    margin-top: 0.04in;
    max-width: 100%;
    word-break: break-all;
  }
  .ptype {
    font-size: 8pt;
    font-weight: 600;
    line-height: 1.1;
    max-width: 100%;
    word-break: break-word;
  }
  .src {
    font-size: 6.25pt;
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
    html, body, .sheet, .spin {
      overflow: visible !important;
    }
    /* Single label only — avoid extra page / bleed into inter-label gap */
    .sheet {
      page-break-inside: avoid;
      break-inside: avoid;
      page-break-after: avoid;
      break-after: avoid;
    }
  }
</style></head><body>${inner}</body></html>`;
}

/**
 * Opens the system print dialog from NexBatch (no new tab — uses a hidden iframe).
 * Portrait sheet (LABEL_PRINT_W × LABEL_PRINT_H); copy rotated sideways and centered; match stock in OS/DYMO.
 */
export function openExtractionBatchLabelPrintWindow(f: ExtractionBatchLabelFields): boolean {
  if (typeof document === "undefined") return false;

  const html = buildLabelPrintDocumentHtml(f);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "Extraction batch label print");
  /**
   * Must NOT use 0×0 viewport: Chrome lays out @page / inch-sized body incorrectly and the job
   * often lands in the gap between die-cut labels or misaligned on DYMO stock.
   * Match @page size off-screen so layout matches physical label registration.
   */
  iframe.style.cssText = [
    "position:fixed",
    "left:-9999px",
    "top:0",
    `width:${LABEL_PRINT_W}`,
    `height:${LABEL_PRINT_H}`,
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
  style?: CSSProperties;
};

/** Large on-screen preview — aspect ratio matches print iframe / @page. */
export function ExtractionBatchLabelPreview({ fields, style }: PreviewProps) {
  const col: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    minWidth: 0,
    flex: "1 1 0",
    height: "100%",
  };

  return (
    <div
      style={{
        width: "min(420px, 92vw)",
        maxWidth: "100%",
        aspectRatio: "2 / 3",
        padding: "clamp(12px, 2.5vw, 20px) clamp(14px, 3vw, 24px)",
        border: "1px solid rgba(148, 163, 184, 0.55)",
        borderRadius: 12,
        background: "linear-gradient(145deg, rgba(15, 23, 42, 0.92), rgba(30, 41, 59, 0.95))",
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
          alignItems: "center",
          justifyContent: "center",
          minHeight: 0,
          width: "100%",
        }}
      >
        <div
          style={{
            transform: `rotate(${LABEL_ROTATE_DEG}deg)`,
            transformOrigin: "center center",
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: "clamp(10px, 2vw, 18px)",
            width: "min(340px, 78vmin)",
            aspectRatio: "3 / 2",
            maxHeight: "92%",
            textAlign: "center",
          }}
        >
        <div
          style={{
            ...col,
            borderRight: "1px solid rgba(148, 163, 184, 0.35)",
            paddingRight: "clamp(8px, 1.5vw, 14px)",
          }}
        >
          <div
            style={{
              fontSize: "clamp(1.15rem, 3.2vw, 1.65rem)",
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
              fontSize: "clamp(0.65rem, 1.6vw, 0.8rem)",
              color: "#94a3b8",
              wordBreak: "break-all",
              marginTop: 8,
              lineHeight: 1.12,
              maxWidth: "100%",
            }}
          >
            {fields.batchId}
          </div>
        </div>
        <div style={{ ...col, paddingLeft: "clamp(4px, 1vw, 8px)" }}>
          <div
            style={{
              fontSize: "clamp(0.9rem, 2.4vw, 1.1rem)",
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
              fontSize: "clamp(0.72rem, 1.8vw, 0.88rem)",
              marginTop: 10,
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
  );
}
