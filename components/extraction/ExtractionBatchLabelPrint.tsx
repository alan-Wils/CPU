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

/** Opens a print dialog with a single 1in × 1.5in sheet; user picks DYMO LabelWriter + label stock in the OS dialog. */
export function openExtractionBatchLabelPrintWindow(f: ExtractionBatchLabelFields): boolean {
  const inner = `
<div class="sheet">
  <div class="code">${escapeHtml(f.marketCode)}</div>
  <div class="id">${escapeHtml(f.batchId)}</div>
  <div class="ptype">${escapeHtml(f.productType)}</div>
  <div class="src">${escapeHtml(f.sourcesLine)}</div>
</div>
<p class="screenOnly">Choose <strong>DYMO LabelWriter 450 Turbo</strong> and <strong>1&quot; × 1.5&quot;</strong> label stock, then print or close.</p>
`;

  const doc = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Extraction batch label</title>
<style>
  @page { size: 1in 1.5in; margin: 0.04in; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; font-family: system-ui, "Segoe UI", Roboto, Arial, sans-serif; background: #f4f4f4; }
  .sheet {
    width: 1in;
    height: 1.5in;
    padding: 3px 4px;
    background: #fff;
    border: 1px solid #ccc;
    margin: 12px auto;
  }
  .code { font-size: 11pt; font-weight: 700; letter-spacing: 0.02em; line-height: 1.1; }
  .id { font-size: 6.5pt; color: #333; word-break: break-all; margin-top: 2px; }
  .ptype { font-size: 8pt; margin-top: 4px; font-weight: 600; line-height: 1.15; }
  .src { font-size: 6.5pt; margin-top: 3px; line-height: 1.15; color: #222; }
  .screenOnly { text-align: center; font-size: 11px; color: #444; padding: 0 16px 16px; max-width: 360px; margin: 0 auto; }
  @media print {
    html, body { background: #fff; }
    .screenOnly { display: none; }
    .sheet { margin: 0; border: none; }
  }
</style></head><body>${inner}
<script>
  window.addEventListener("load", function () {
    setTimeout(function () { window.print(); }, 150);
  });
</script>
</body></html>`;

  const w = window.open("", "_blank", "noopener,noreferrer,width=440,height=560");
  if (!w) return false;
  w.document.open();
  w.document.write(doc);
  w.document.close();
  return true;
}

type PreviewProps = {
  fields: ExtractionBatchLabelFields;
  style?: CSSProperties;
};

export function ExtractionBatchLabelPreview({ fields, style }: PreviewProps) {
  return (
    <div
      style={{
        width: "1in",
        height: "1.5in",
        padding: "3px 4px",
        border: "1px solid rgba(148, 163, 184, 0.6)",
        borderRadius: 6,
        background: "rgba(15, 23, 42, 0.85)",
        color: "#e2e8f0",
        fontFamily: "system-ui, Segoe UI, Roboto, Arial, sans-serif",
        overflow: "hidden",
        ...style,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.1 }}>{fields.marketCode}</div>
      <div
        style={{
          fontSize: 7,
          color: "#94a3b8",
          wordBreak: "break-all",
          marginTop: 2,
        }}
      >
        {fields.batchId}
      </div>
      <div style={{ fontSize: 8, fontWeight: 600, marginTop: 4, lineHeight: 1.15 }}>
        {fields.productType}
      </div>
      <div style={{ fontSize: 6.5, marginTop: 3, lineHeight: 1.15, color: "#cbd5e1" }}>
        {fields.sourcesLine}
      </div>
    </div>
  );
}
