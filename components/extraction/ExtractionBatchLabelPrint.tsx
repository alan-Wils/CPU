"use client";

import type { CSSProperties } from "react";

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
`;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Extraction batch label</title>
<style>
  /* Exactly one physical label; zero margins avoids Chrome counting a 2nd sheet */
  @page {
    size: 1.5in 1in;
    margin: 0;
  }
  * { box-sizing: border-box; }
  html {
    width: 1.5in;
    height: 1in;
    margin: 0;
    padding: 0;
    overflow: hidden;
  }
  body {
    margin: 0;
    padding: 0;
    width: 1.5in;
    height: 1in;
    max-width: 1.5in;
    max-height: 1in;
    overflow: hidden;
    font-family: system-ui, "Segoe UI", Roboto, Arial, sans-serif;
    background: #fff;
    page-break-after: avoid;
    break-after: avoid;
  }
  .sheet {
    width: 1.5in;
    height: 1in;
    max-width: 1.5in;
    max-height: 1in;
    margin: 0;
    padding: 0.07in 0.08in;
    background: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .inner {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 0.06in;
    text-align: center;
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
    font-size: 11pt;
    font-weight: 700;
    letter-spacing: 0.03em;
    line-height: 1.08;
    max-width: 100%;
    word-break: break-word;
  }
  .id {
    font-size: 6.5pt;
    color: #333;
    line-height: 1.12;
    margin-top: 0.05in;
    max-width: 100%;
    word-break: break-all;
  }
  .ptype {
    font-size: 8.5pt;
    font-weight: 600;
    line-height: 1.12;
    max-width: 100%;
    word-break: break-word;
  }
  .src {
    font-size: 6.5pt;
    margin-top: 0.05in;
    line-height: 1.12;
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
  }
</style></head><body>${inner}</body></html>`;
}

/**
 * Opens the system print dialog from NexBatch (no new tab — uses a hidden iframe).
 * One horizontal sheet 1.5in × 1in; user picks DYMO + stock in the OS dialog.
 */
export function openExtractionBatchLabelPrintWindow(f: ExtractionBatchLabelFields): boolean {
  if (typeof document === "undefined") return false;

  const html = buildLabelPrintDocumentHtml(f);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "Extraction batch label print");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.style.visibility = "hidden";
  iframe.style.pointerEvents = "none";

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

/** Large on-screen preview (horizontal strip), centered — matches print iframe layout. */
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
        width: "min(560px, 92vw)",
        maxWidth: "100%",
        aspectRatio: "3 / 2",
        padding: "clamp(12px, 2.5vw, 20px) clamp(14px, 3vw, 24px)",
        border: "1px solid rgba(148, 163, 184, 0.55)",
        borderRadius: 12,
        background: "linear-gradient(145deg, rgba(15, 23, 42, 0.92), rgba(30, 41, 59, 0.95))",
        color: "#e2e8f0",
        fontFamily: "system-ui, Segoe UI, Roboto, Arial, sans-serif",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: "clamp(10px, 2vw, 18px)",
          width: "100%",
          height: "100%",
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
  );
}
