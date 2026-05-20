"use client";

import type { CSSProperties } from "react";
import {
  buildExtractionBatchSheetModel,
  buildCombinedExtractionBatchSheetsPrintHtml,
  type ExtractionBatchSheetModel,
} from "@/lib/extractionBatchSheet";
import {
  buildMipSamplePlanModel,
  buildMipSamplePlanPrintHtml,
  DEFAULT_MIP_SAMPLE_PLAN_FACILITY,
  type MipSamplePlanFacility,
} from "@/lib/mipSamplePlan";
import { EM_DASH, SEP_DOT } from "@/lib/textSymbols";

export { buildExtractionBatchSheetModel, type ExtractionBatchSheetModel };
export {
  buildMipSamplePlanModel,
  DEFAULT_MIP_SAMPLE_PLAN_FACILITY,
  type MipSamplePlanFacility,
};

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

export function openCombinedExtractionBatchSheetsPrint(
  batch: any,
  options?: {
    resolveSource?: (sourceId: string) => any | null | undefined;
    nextRequiredTask?: string;
    mipFacility?: MipSamplePlanFacility;
  },
): boolean {
  const process = buildExtractionBatchSheetModel(batch, {
    resolveSource: options?.resolveSource,
    nextRequiredTask: options?.nextRequiredTask,
  });
  const mip = buildMipSamplePlanModel(batch, process, options?.mipFacility);
  const html = buildCombinedExtractionBatchSheetsPrintHtml(
    process,
    buildMipSamplePlanPrintHtml(mip),
  );
  return openPrintHtmlDocument(html, `Batch sheets ${process.marketBatchCode}`);
}

type PreviewProps = {
  process: ExtractionBatchSheetModel;
  mipFacility?: MipSamplePlanFacility;
  batch?: any;
  style?: CSSProperties;
};

/** On-screen preview before printing (summaries both sheets). */
export function ExtractionBatchSheetPreview({
  process,
  mipFacility,
  batch,
  style,
}: PreviewProps) {
  const mip = buildMipSamplePlanModel(batch ?? {}, process, mipFacility);
  const strainDisplay =
    process.sourceBlendLabel && process.sourceBlendLabel !== EM_DASH
      ? process.sourceBlendLabel
      : [...new Set(process.sourceRows.map((r) => r.strain))].join(", ") || EM_DASH;

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 720,
        margin: "0 auto",
        display: "grid",
        gap: 14,
        ...style,
      }}
    >
      <div
        style={{
          padding: 16,
          borderRadius: 12,
          border: "1px solid #334155",
          background: "#0f172a",
          color: "#e2e8f0",
          fontSize: 12,
          lineHeight: 1.45,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 14, color: "#22d3ee", marginBottom: 6 }}>
          Sheet 1 — Process reference (extraction)
        </div>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>{process.marketBatchCode}</div>
        <div style={{ color: "#94a3b8", marginBottom: 10 }}>
          Strain: {strainDisplay}
          {SEP_DOT}
          Product: {process.productType}
        </div>
        {process.sourceRows.length === 0 ? (
          <p style={{ color: "#94a3b8", margin: 0 }}>No source rows on this batch.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ color: "#94a3b8", textAlign: "left" }}>
                <th style={{ padding: "4px 6px", borderBottom: "1px solid #334155" }}>Strain</th>
                <th style={{ padding: "4px 6px", borderBottom: "1px solid #334155" }}>METRC</th>
                <th style={{ padding: "4px 6px", borderBottom: "1px solid #334155" }}>Used</th>
              </tr>
            </thead>
            <tbody>
              {process.sourceRows.map((r) => (
                <tr key={r.index}>
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
      </div>

      <div
        style={{
          padding: 16,
          borderRadius: 12,
          border: "1px solid #334155",
          background: "#0c1222",
          color: "#e2e8f0",
          fontSize: 12,
          lineHeight: 1.45,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 14, color: "#a78bfa", marginBottom: 6 }}>
          Sheet 2 — MIP sample plan (testing &amp; packaging)
        </div>
        <div style={{ color: "#94a3b8", marginBottom: 8 }}>
          {mip.facility.businessName} · {mip.facility.businessLicenseId}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "4px 12px",
            marginBottom: 10,
          }}
        >
          <span style={{ color: "#64748b" }}>Production batch</span>
          <span>{mip.productionBatchId}</span>
          <span style={{ color: "#64748b" }}>Size (g)</span>
          <span>{mip.productionBatchSizeGrams || EM_DASH}</span>
          <span style={{ color: "#64748b" }}>Containers</span>
          <span>{mip.storageContainerCount}</span>
        </div>
        <p style={{ color: "#64748b", margin: 0, fontSize: 11 }}>
          Full MIP form includes sample increments (0.25 g), signature lines, and test checkboxes.
          Pre-fills METRC tags from source packages when available.
        </p>
      </div>
    </div>
  );
}

export function buildAndPrintExtractionBatchSheet(
  batch: any,
  options?: {
    resolveSource?: (sourceId: string) => any | null | undefined;
    nextRequiredTask?: string;
    mipFacility?: MipSamplePlanFacility;
  },
): boolean {
  return openCombinedExtractionBatchSheetsPrint(batch, options);
}
