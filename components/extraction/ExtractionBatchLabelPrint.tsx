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
  <div class="col left">
    <div class="code">${escapeHtml(f.marketCode)}</div>
    <div class="id">${escapeHtml(f.batchId)}</div>
  </div>
  <div class="col right">
    <div class="ptype">${escapeHtml(f.productType)}</div>
    <div class="src">${escapeHtml(f.sourcesLine)}</div>
  </div>
</div>
<p class="screenOnly">Choose <strong>DYMO LabelWriter 450 Turbo</strong> and a <strong>1.5&quot; × 1&quot;</strong> (horizontal) label, then print or cancel.</p>
`;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Extraction batch label</title>
<style>
  @page { size: 1.5in 1in; margin: 0.04in; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    min-height: 100vh;
    font-family: system-ui, "Segoe UI", Roboto, Arial, sans-serif;
    background: #e8e8ea;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .sheet {
    width: 1.5in;
    height: 1in;
    padding: 4px 6px;
    background: #fff;
    border: 1px solid #bbb;
    border-radius: 2px;
    display: flex;
    flex-direction: row;
    align-items: stretch;
    gap: 6px;
    margin: 16px auto;
  }
  .col { display: flex; flex-direction: column; justify-content: center; min-width: 0; }
  .left { flex: 0 0 38%; border-right: 1px solid #ddd; padding-right: 6px; }
  .right { flex: 1; padding-left: 2px; }
  .code { font-size: 10pt; font-weight: 700; letter-spacing: 0.02em; line-height: 1.05; }
  .id { font-size: 5.5pt; color: #444; word-break: break-all; margin-top: 3px; line-height: 1.1; }
  .ptype { font-size: 7.5pt; font-weight: 600; line-height: 1.1; }
  .src { font-size: 5.5pt; margin-top: 3px; line-height: 1.12; color: #222; }
  .screenOnly { text-align: center; font-size: 12px; color: #333; padding: 0 20px 24px; max-width: 420px; margin: 0 auto; }
  @media print {
    html, body { background: #fff; display: block; min-height: 0; }
    .screenOnly { display: none; }
    .sheet { margin: 0; border: none; border-radius: 0; }
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

/** Large on-screen preview (horizontal strip), centered by parent. */
export function ExtractionBatchLabelPreview({ fields, style }: PreviewProps) {
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
        flexDirection: "row",
        alignItems: "stretch",
        gap: "clamp(10px, 2vw, 18px)",
        boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
        ...style,
      }}
    >
      <div
        style={{
          flex: "0 0 38%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          borderRight: "1px solid rgba(148, 163, 184, 0.35)",
          paddingRight: "clamp(8px, 1.5vw, 14px)",
          minWidth: 0,
        }}
      >
        <div
          style={{
            fontSize: "clamp(1.15rem, 3.2vw, 1.65rem)",
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: "0.02em",
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
            lineHeight: 1.15,
          }}
        >
          {fields.batchId}
        </div>
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          minWidth: 0,
        }}
      >
        <div
          style={{
            fontSize: "clamp(0.85rem, 2.2vw, 1.05rem)",
            fontWeight: 600,
            lineHeight: 1.15,
          }}
        >
          {fields.productType}
        </div>
        <div
          style={{
            fontSize: "clamp(0.7rem, 1.7vw, 0.85rem)",
            marginTop: 10,
            lineHeight: 1.2,
            color: "#cbd5e1",
          }}
        >
          {fields.sourcesLine}
        </div>
      </div>
    </div>
  );
}
