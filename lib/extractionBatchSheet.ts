import {
  collectExtractionCultivationSourceLabels,
  extractionBatchMarketBatchCode,
  formatExtractionCultivationSourceFooter,
} from "@/lib/extractionBatchDisplay";
import {
  extractionBatchBiomassLbs,
  extractionBatchOilGrams,
  resolveExtractionBatchSourceRows,
} from "@/lib/extractionMergeHelpers";
import {
  freshFrozenPackageDisplay,
  GRAMS_PER_LB,
  isPlaceholderFreshFrozenMetrcTag,
} from "@/lib/freshFrozenPackageDisplay";
import { EM_DASH } from "@/lib/textSymbols";

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatGramsLbs(grams: number): { gramsLabel: string; lbsLabel: string } {
  const g = num(grams);
  if (g <= 0) {
    return { gramsLabel: EM_DASH, lbsLabel: EM_DASH };
  }
  const lbs = +(g / GRAMS_PER_LB).toFixed(4);
  return {
    gramsLabel: `${Math.round(g).toLocaleString()} g`,
    lbsLabel: `${lbs.toFixed(2)} lbs`,
  };
}

function sourcePackageId(row: { id?: string; harvestCode?: string } | null | undefined): string {
  if (!row) return EM_DASH;
  return String(row.harvestCode || row.id || "").trim() || EM_DASH;
}

function materialLabel(
  row: { materialType?: string },
  src: Record<string, unknown> | null | undefined,
): string {
  const mt = String(row?.materialType || "").toLowerCase();
  if (mt === "freshfrozen" || mt.includes("fresh")) return "Fresh Frozen";
  if (mt === "drytrim" || mt.includes("dry")) return "Dry Trim";
  const typ = String(src?.type || "").toLowerCase();
  if (typ.includes("fresh") || typ.includes("frozen")) return "Fresh Frozen";
  if (typ.includes("dry") || typ.includes("trim")) return "Dry Trim";
  return String(src?.type || row?.materialType || EM_DASH).trim() || EM_DASH;
}

function metrcDisplay(src: Record<string, unknown> | null | undefined): string {
  const tag = String(src?.metrcTag || src?.plantTag || "").trim();
  if (!tag) return EM_DASH;
  if (isPlaceholderFreshFrozenMetrcTag(tag)) return `${tag} (assign METRC)`;
  return tag;
}

function packSocksLines(batch: any): string[] {
  const lines: string[] = [];
  const stop = batch?.taskData?.["Pack Socks Stop"];
  if (stop && typeof stop === "object") {
    const socks = num((stop as { totalSocksPacked?: unknown }).totalSocksPacked);
    const prepG = num((stop as { totalPreparedGrams?: unknown }).totalPreparedGrams);
    const prepLbs = num((stop as { totalPreparedLbs?: unknown }).totalPreparedLbs);
    const avg = num((stop as { averageGramsPerSock?: unknown }).averageGramsPerSock);
    if (socks > 0) lines.push(`Socks prepared: ${socks}`);
    if (prepG > 0) lines.push(`Total prepared: ${Math.round(prepG).toLocaleString()} g`);
    else if (prepLbs > 0) lines.push(`Total prepared: ${prepLbs.toFixed(2)} lbs`);
    if (avg > 0) lines.push(`Average per sock: ${avg.toFixed(2)} g`);
    const duration = String((stop as { prepDuration?: unknown }).prepDuration || "").trim();
    if (duration && duration !== EM_DASH) lines.push(`Prep duration: ${duration}`);
  }
  const start = batch?.taskData?.["Pack Socks Start"];
  if (start && typeof start === "object") {
    const at = String((start as { startedAtDisplay?: unknown }).startedAtDisplay || "").trim();
    if (at) lines.push(`Pack socks started: ${at}`);
  }
  return lines;
}

export type ExtractionBatchSheetSourceRow = {
  index: number;
  strain: string;
  metrcTag: string;
  packageId: string;
  material: string;
  usedGramsLabel: string;
  usedLbsLabel: string;
  cultivationBatch: string;
  packageDetail: string;
};

export type ExtractionBatchSheetModel = {
  runId: string;
  marketBatchCode: string;
  productType: string;
  batchName: string;
  status: string;
  createdAt: string;
  sourceBlendLabel: string;
  cultivationSourceLine: string;
  totalBiomassGramsLabel: string;
  totalBiomassLbsLabel: string;
  finalOilGramsLabel: string;
  nextRequiredTask: string;
  sourceRows: ExtractionBatchSheetSourceRow[];
  packSocksLines: string[];
  completedTasks: string[];
  printedAtLabel: string;
};

export function buildExtractionBatchSheetModel(
  batch: any,
  options?: {
    resolveSource?: (sourceId: string) => any | null | undefined;
    nextRequiredTask?: string;
    printedAt?: Date;
  },
): ExtractionBatchSheetModel {
  const resolveSource = options?.resolveSource;
  const rows = resolveExtractionBatchSourceRows(batch, resolveSource);
  const biomassLbs = extractionBatchBiomassLbs(batch);
  const biomassG = biomassLbs > 0 ? biomassLbs * GRAMS_PER_LB : 0;
  const biomassFmt = formatGramsLbs(biomassG);
  const oilG =
    num(batch?.totalFinalGrams) || extractionBatchOilGrams(batch) + num(batch?.extraTerpsGrams);
  const oilFmt = formatGramsLbs(oilG);

  const sourceRows: ExtractionBatchSheetSourceRow[] = rows.map((row, idx) => {
    const sourceId = String(row?.sourceId || "").trim();
    const src =
      resolveSource?.(sourceId) && typeof resolveSource(sourceId) === "object"
        ? (resolveSource(sourceId) as Record<string, unknown>)
        : null;
    const usedLbs = num(row?.amountUsed ?? row?.amount);
    const usedG = usedLbs > 0 ? usedLbs * GRAMS_PER_LB : 0;
    const usedFmt = formatGramsLbs(usedG);
    const mat = materialLabel(row, src);
    let packageDetail = "";
    if (mat === "Fresh Frozen" && src) {
      packageDetail = freshFrozenPackageDisplay(src).packageLine;
    } else if (src) {
      const origLbs = num(src.weightLbs) || (num(src.grams) > 0 ? num(src.grams) / GRAMS_PER_LB : 0);
      if (origLbs > 0) {
        packageDetail = `Original package: ${formatGramsLbs(origLbs * GRAMS_PER_LB).gramsLabel}`;
      }
    }
    return {
      index: idx + 1,
      strain: String(row?.name || src?.name || sourceId || EM_DASH).trim() || EM_DASH,
      metrcTag: metrcDisplay(src),
      packageId: sourcePackageId(src ?? { id: sourceId }),
      material: mat,
      usedGramsLabel: usedFmt.gramsLabel,
      usedLbsLabel: usedFmt.lbsLabel,
      cultivationBatch: String(src?.source || src?.harvestCode || "").trim() || EM_DASH,
      packageDetail,
    };
  });

  const completed = Array.isArray(batch?.completedTasks)
    ? (batch.completedTasks as unknown[]).map((t) => String(t).trim()).filter(Boolean)
    : [];

  const printedAt = options?.printedAt ?? new Date();
  const printedAtLabel = printedAt.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return {
    runId: String(batch?.id || "").trim() || EM_DASH,
    marketBatchCode: extractionBatchMarketBatchCode(batch),
    productType: String(batch?.productType || batch?.name || "").trim() || EM_DASH,
    batchName: String(batch?.name || "").trim() || EM_DASH,
    status: String(batch?.status || "").trim() || EM_DASH,
    createdAt: String(batch?.createdAt || "").trim() || EM_DASH,
    sourceBlendLabel: String(batch?.sourceBlendLabel || "").trim() || EM_DASH,
    cultivationSourceLine: formatExtractionCultivationSourceFooter(
      collectExtractionCultivationSourceLabels(batch, resolveSource),
    ),
    totalBiomassGramsLabel: biomassFmt.gramsLabel,
    totalBiomassLbsLabel: biomassFmt.lbsLabel,
    finalOilGramsLabel: oilFmt.gramsLabel,
    nextRequiredTask: String(options?.nextRequiredTask || "").trim() || EM_DASH,
    sourceRows,
    packSocksLines: packSocksLines(batch),
    completedTasks: completed,
    printedAtLabel,
  };
}

function renderSourceTable(rows: ExtractionBatchSheetSourceRow[]): string {
  if (rows.length === 0) {
    return `<p class="muted">No source rows recorded on this batch.</p>`;
  }
  const body = rows
    .map(
      (r) => `<tr>
        <td>${r.index}</td>
        <td>${escapeHtml(r.strain)}</td>
        <td>${escapeHtml(r.metrcTag)}</td>
        <td>${escapeHtml(r.packageId)}</td>
        <td>${escapeHtml(r.material)}</td>
        <td>${escapeHtml(r.usedGramsLabel)}</td>
        <td>${escapeHtml(r.usedLbsLabel)}</td>
        <td>${escapeHtml(r.cultivationBatch)}</td>
        <td>${escapeHtml(r.packageDetail || EM_DASH)}</td>
      </tr>`,
    )
    .join("");
  return `<table class="sources">
    <thead><tr>
      <th>#</th><th>Strain</th><th>METRC tag</th><th>Package ID</th><th>Material</th>
      <th>Used (g)</th><th>Used (lbs)</th><th>Cultivation batch</th><th>Package notes</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

const BATCH_PRINT_SHARED_CSS = `
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, system-ui, sans-serif; color: #111; margin: 0; padding: 0; font-size: 11px; line-height: 1.35; }
  .sheet { padding: 14px 16px; }
  .sheet.process h1 { font-size: 22px; margin: 0 0 6px; }
  .sheet-tag { font-size: 11px; color: #444; margin: 0 0 12px; font-weight: 600; }
  .hero { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 14px; }
  .hero .card { border: 2px solid #222; padding: 10px 12px; min-height: 52px; }
  .hero .lbl { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #333; margin-bottom: 4px; }
  .hero .val { font-size: 15px; font-weight: 700; word-break: break-word; }
  h2 { font-size: 13px; margin: 12px 0 6px; border-bottom: 2px solid #222; padding-bottom: 3px; }
  table.sources { width: 100%; border-collapse: collapse; font-size: 11px; }
  table.sources th, table.sources td { border: 1px solid #333; padding: 5px 6px; text-align: left; vertical-align: top; }
  table.sources th { background: #e8e8e8; font-weight: 700; }
  table.sources tr:nth-child(even) td { background: #fafafa; }
  .meta-row { font-size: 10px; color: #444; margin-top: 10px; }
  .footer { margin-top: 12px; font-size: 10px; color: #666; border-top: 1px solid #ccc; padding-top: 6px; }
  .muted { color: #555; font-style: italic; }
  .no-print { margin: 12px 16px; }
  .no-print button { font-size: 14px; padding: 8px 16px; cursor: pointer; }
  .sheet.mip h1 { font-size: 18px; text-align: center; margin: 0 0 4px; text-decoration: underline; }
  table.form-lines { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  table.form-lines td { border: 1px solid #333; padding: 4px 6px; vertical-align: middle; }
  table.form-lines .lbl { font-weight: 700; white-space: nowrap; background: #f5f5f5; width: 1%; }
  table.form-lines .lbl.wide { min-width: 180px; }
  table.two-col .lbl { width: 28%; }
  .inline-lbl { margin: 8px 0 4px; font-weight: 700; }
  .split { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: start; }
  table.grid td { border: 1px solid #333; padding: 3px 5px; font-size: 10px; }
  table.grid .lbl { font-weight: 700; background: #f0f0f0; }
  .inc-title { font-weight: 700; font-size: 10px; text-align: center; margin-bottom: 4px; }
  table.increments { width: 100%; border-collapse: collapse; font-size: 9px; }
  table.increments th, table.increments td { border: 1px solid #333; padding: 2px 3px; text-align: center; }
  table.increments .loc { font-weight: 700; background: #fafafa; height: 14px; }
  table.increments .wt { height: 14px; }
  table.mini { margin-top: 6px; }
  .box { border: 1px solid #333; margin-top: 6px; }
  .box-lbl { font-weight: 700; font-size: 10px; padding: 4px 6px; border-bottom: 1px solid #333; background: #f5f5f5; }
  .box-body { min-height: 48px; padding: 6px; }
  .box-body.tall { min-height: 72px; }
  .tested { margin: 8px 0; font-size: 10px; }
  .test { margin-right: 6px; }
  .test.on { font-weight: 700; text-decoration: underline; }
  .lbl-inline { font-weight: 700; }
  .blank { display: inline-block; min-width: 80%; border-bottom: 1px solid #999; min-height: 14px; }
  @media print {
    .no-print { display: none !important; }
    .sheet { page-break-after: always; padding: 10mm; }
    .sheet:last-child { page-break-after: auto; }
    @page { size: letter portrait; margin: 10mm; }
    tr { page-break-inside: avoid; }
  }
`;

/** Sheet 1: follows the batch through extraction (sources, METRC, weights). */
export function buildExtractionProcessReferencePrintHtml(model: ExtractionBatchSheetModel): string {
  const strainDisplay =
    model.sourceBlendLabel && model.sourceBlendLabel !== EM_DASH
      ? model.sourceBlendLabel
      : [...new Set(model.sourceRows.map((r) => r.strain).filter((s) => s && s !== EM_DASH))].join(
          " · ",
        ) || EM_DASH;

  const sourceTableSlim =
    model.sourceRows.length === 0
      ? `<p class="muted">No source packages on this batch.</p>`
      : `<table class="sources"><thead><tr>
          <th>#</th><th>Strain</th><th>METRC #</th><th>Package</th><th>Used (g)</th><th>Used (lbs)</th>
        </tr></thead><tbody>${model.sourceRows
          .map(
            (r) => `<tr>
            <td>${r.index}</td>
            <td>${escapeHtml(r.strain)}</td>
            <td>${escapeHtml(r.metrcTag)}</td>
            <td>${escapeHtml(r.packageId)}</td>
            <td>${escapeHtml(r.usedGramsLabel)}</td>
            <td>${escapeHtml(r.usedLbsLabel)}</td>
          </tr>`,
          )
          .join("")}</tbody></table>`;

  return `<section class="sheet process">
  <h1>Extraction process reference</h1>
  <p class="sheet-tag">Sheet 1 of 2 — keep with batch through prep, pack socks, and extraction</p>
  <div class="hero">
    <div class="card"><div class="lbl">Market batch code</div><div class="val">${escapeHtml(model.marketBatchCode)}</div></div>
    <div class="card"><div class="lbl">Strain / blend</div><div class="val">${escapeHtml(strainDisplay)}</div></div>
    <div class="card"><div class="lbl">Product</div><div class="val">${escapeHtml(model.productType)}</div></div>
  </div>
  <p class="meta-row">Run ID: ${escapeHtml(model.runId)} · Status: ${escapeHtml(model.status)} · Biomass: ${escapeHtml(model.totalBiomassGramsLabel)} (${escapeHtml(model.totalBiomassLbsLabel)}) · Next: ${escapeHtml(model.nextRequiredTask)}</p>
  <h2>Source packages (strains, METRC tags, weights)</h2>
  ${sourceTableSlim}
  <div class="footer">Printed ${escapeHtml(model.printedAtLabel)} · NexBatch — attach through extraction; use Sheet 2 for lab sample plan at testing/packaging.</div>
</section>`;
}

/** @deprecated Use {@link buildCombinedExtractionBatchSheetsPrintHtml} for two-sheet print. */
export function buildExtractionBatchSheetPrintHtml(model: ExtractionBatchSheetModel): string {
  return buildExtractionProcessReferencePrintHtml(model);
}

export function buildCombinedExtractionBatchSheetsPrintHtml(
  process: ExtractionBatchSheetModel,
  mipHtml: string,
): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Batch sheets ${escapeHtml(process.marketBatchCode)}</title>
<style>${BATCH_PRINT_SHARED_CSS}</style></head><body>
<p class="no-print"><button type="button" onclick="window.print()">Print both sheets</button></p>
${buildExtractionProcessReferencePrintHtml(process)}
${mipHtml}
</body></html>`;
}
