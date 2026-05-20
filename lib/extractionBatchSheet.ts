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

export function buildExtractionBatchSheetPrintHtml(model: ExtractionBatchSheetModel): string {
  const metaRows = [
    ["Extraction run ID", model.runId],
    ["Market batch code", model.marketBatchCode],
    ["Product type", model.productType],
    ["Batch name", model.batchName],
    ["Status", model.status],
    ["Created", model.createdAt],
    ["Strain blend", model.sourceBlendLabel],
    ["Cultivation sources", model.cultivationSourceLine || EM_DASH],
    ["Total biomass", `${model.totalBiomassGramsLabel} (${model.totalBiomassLbsLabel})`],
    ["Final oil (if logged)", model.finalOilGramsLabel],
    ["Next required task", model.nextRequiredTask],
  ]
    .map(
      ([label, value]) =>
        `<tr><th>${escapeHtml(String(label))}</th><td>${escapeHtml(String(value))}</td></tr>`,
    )
    .join("");

  const packBlock =
    model.packSocksLines.length > 0
      ? `<h2>Pack socks</h2><ul>${model.packSocksLines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`
      : "";

  const tasksBlock =
    model.completedTasks.length > 0
      ? `<h2>Completed tasks</h2><ul class="tasks">${model.completedTasks
          .map((t) => `<li>${escapeHtml(t)}</li>`)
          .join("")}</ul>`
      : `<p class="muted">No tasks logged yet.</p>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Batch sheet ${escapeHtml(model.marketBatchCode)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, Segoe UI, Roboto, Arial, sans-serif; color: #111; margin: 0; padding: 16px 18px; font-size: 12px; line-height: 1.4; }
  h1 { font-size: 20px; margin: 0 0 4px; letter-spacing: 0.02em; }
  .subtitle { font-size: 13px; color: #444; margin: 0 0 14px; }
  h2 { font-size: 14px; margin: 18px 0 8px; border-bottom: 2px solid #222; padding-bottom: 4px; }
  table.meta { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  table.meta th, table.meta td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
  table.meta th { width: 32%; background: #f0f0f0; font-weight: 600; }
  table.sources { width: 100%; border-collapse: collapse; font-size: 11px; }
  table.sources th, table.sources td { border: 1px solid #333; padding: 5px 6px; text-align: left; vertical-align: top; }
  table.sources th { background: #e8e8e8; font-weight: 700; }
  table.sources tr:nth-child(even) td { background: #fafafa; }
  ul { margin: 0; padding-left: 18px; }
  ul.tasks { columns: 2; column-gap: 24px; }
  .muted { color: #555; font-style: italic; }
  .footer { margin-top: 20px; font-size: 10px; color: #666; border-top: 1px solid #ccc; padding-top: 8px; }
  .no-print { margin: 12px 0; }
  .no-print button { font-size: 14px; padding: 8px 16px; cursor: pointer; }
  @media print {
    .no-print { display: none !important; }
    body { padding: 10mm; }
    @page { size: letter portrait; margin: 12mm; }
    table.sources { page-break-inside: auto; }
    tr { page-break-inside: avoid; }
  }
</style></head><body>
  <h1>Extraction batch reference sheet</h1>
  <p class="subtitle"><strong>${escapeHtml(model.marketBatchCode)}</strong> &mdash; attach to physical batch through prep, extraction, purge, and testing.</p>
  <p class="no-print"><button type="button" onclick="window.print()">Print</button></p>
  <h2>Batch summary</h2>
  <table class="meta">${metaRows}</table>
  <h2>Source material (strains, METRC, weights)</h2>
  ${renderSourceTable(model.sourceRows)}
  ${packBlock}
  <h2>Workflow</h2>
  ${tasksBlock}
  <div class="footer">Printed ${escapeHtml(model.printedAtLabel)} &middot; NexBatch extraction</div>
</body></html>`;
}
