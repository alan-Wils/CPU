"use client";

import type { CSSProperties } from "react";
import {
  buildExtractionBatchSheetModel,
  buildExtractionBatchSheetPrintHtml,
  type ExtractionBatchSheetModel,
} from "@/lib/extractionBatchSheet";
import { EM_DASH, SEP_DOT } from "@/lib/textSymbols";

export { buildExtractionBatchSheetModel, type ExtractionBatchSheetModel };

function openPrintHtmlDocument(html: string, title: string): boolean {
  if (typeof document === "undefined") return false;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", title);
  iframe.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    "width:100%",
    "height:100%",
    "margin:0",
    "padding:0",
    "border:0",
    "opacity:0",
    "pointer-events:none",
    "z-index:99999",
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

  const remove = () => iframe.remove();
  const runPrint = () => {
    try {
      cw.focus();
      cw.print();
    } catch {
      remove();
      return;
    }
    cw.addEventListener("afterprint", remove, { once: true });
    setTimeout(remove, 5000);
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(() => setTimeout(runPrint, 150));
  });
  return true;
}

export function openExtractionBatchSheetPrintWindow(model: ExtractionBatchSheetModel): boolean {
  const html = buildExtractionBatchSheetPrintHtml(model);
  return openPrintHtmlDocument(html, `Extraction batch sheet ${model.marketBatchCode}`);
}

type PreviewProps = {
  model: ExtractionBatchSheetModel;
  style?: CSSProperties;
};

/** On-screen preview before printing (matches print content). */
export function ExtractionBatchSheetPreview({ model, style }: PreviewProps) {
  return (
    <div
      style={{
        width: "100%",
        maxWidth: 720,
        margin: "0 auto",
        padding: 16,
        borderRadius: 12,
        border: "1px solid #334155",
        background: "#0f172a",
        color: "#e2e8f0",
        fontSize: 12,
        lineHeight: 1.45,
        ...style,
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Batch reference sheet</div>
      <div style={{ color: "#94a3b8", marginBottom: 12 }}>
        {model.marketBatchCode}
        {SEP_DOT}
        {model.runId}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "140px 1fr",
          gap: "4px 12px",
          marginBottom: 14,
        }}
      >
        <span style={{ color: "#94a3b8" }}>Product</span>
        <span>{model.productType}</span>
        <span style={{ color: "#94a3b8" }}>Biomass</span>
        <span>
          {model.totalBiomassGramsLabel} ({model.totalBiomassLbsLabel})
        </span>
        <span style={{ color: "#94a3b8" }}>Next task</span>
        <span>{model.nextRequiredTask}</span>
      </div>
      {model.sourceRows.length === 0 ? (
        <p style={{ color: "#94a3b8", margin: 0 }}>No source rows on this batch.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#94a3b8" }}>
              <th style={{ padding: "4px 6px", borderBottom: "1px solid #334155" }}>#</th>
              <th style={{ padding: "4px 6px", borderBottom: "1px solid #334155" }}>Strain</th>
              <th style={{ padding: "4px 6px", borderBottom: "1px solid #334155" }}>METRC</th>
              <th style={{ padding: "4px 6px", borderBottom: "1px solid #334155" }}>Used</th>
            </tr>
          </thead>
          <tbody>
            {model.sourceRows.map((r) => (
              <tr key={r.index}>
                <td style={{ padding: "4px 6px", borderBottom: "1px solid #1e293b" }}>{r.index}</td>
                <td style={{ padding: "4px 6px", borderBottom: "1px solid #1e293b" }}>{r.strain}</td>
                <td style={{ padding: "4px 6px", borderBottom: "1px solid #1e293b" }}>{r.metrcTag}</td>
                <td style={{ padding: "4px 6px", borderBottom: "1px solid #1e293b" }}>
                  {r.usedGramsLabel}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p style={{ color: "#64748b", margin: "12px 0 0", fontSize: 11 }}>
        Full sheet includes package IDs, cultivation batches, pack socks, and completed tasks.
      </p>
    </div>
  );
}

export function buildAndPrintExtractionBatchSheet(
  batch: any,
  options?: {
    resolveSource?: (sourceId: string) => any | null | undefined;
    nextRequiredTask?: string;
  },
): boolean {
  const model = buildExtractionBatchSheetModel(batch, options);
  return openExtractionBatchSheetPrintWindow(model);
}
