import type { ExtractionBatchSheetModel, ExtractionBatchSheetSourceRow } from "@/lib/extractionBatchSheet";
import { EM_DASH } from "@/lib/textSymbols";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function field(value: string): string {
  const v = String(value || "").trim();
  return v ? escapeHtml(v) : "&nbsp;";
}

function blankLine(): string {
  return '<span class="blank">&nbsp;</span>';
}

export type MipSamplePlanFacility = {
  businessName: string;
  businessLicenseId: string;
  facilityAddress: string;
  alternateBusinessName: string;
};

export const DEFAULT_MIP_SAMPLE_PLAN_FACILITY: MipSamplePlanFacility = {
  businessName: "BUD FOX ENTERPRISES LLC",
  businessLicenseId: "404R-00334",
  facilityAddress: "14896 E 38th Ave. Aurora, CO 80011",
  alternateBusinessName: "Bud Fox Supply Co",
};

/** Read facility header lines from company config `extraction.mipSamplePlan`. */
export function readMipSamplePlanFacilityFromConfig(companyConfig: unknown): MipSamplePlanFacility {
  const root =
    companyConfig && typeof companyConfig === "object"
      ? (companyConfig as Record<string, unknown>)
      : {};
  const extraction =
    root.extraction && typeof root.extraction === "object"
      ? (root.extraction as Record<string, unknown>)
      : {};
  const mip =
    extraction.mipSamplePlan && typeof extraction.mipSamplePlan === "object"
      ? (extraction.mipSamplePlan as Record<string, unknown>)
      : {};
  return {
    businessName: String(mip.businessName ?? DEFAULT_MIP_SAMPLE_PLAN_FACILITY.businessName).trim(),
    businessLicenseId: String(
      mip.businessLicenseId ?? DEFAULT_MIP_SAMPLE_PLAN_FACILITY.businessLicenseId,
    ).trim(),
    facilityAddress: String(
      mip.facilityAddress ?? DEFAULT_MIP_SAMPLE_PLAN_FACILITY.facilityAddress,
    ).trim(),
    alternateBusinessName: String(
      mip.alternateBusinessName ?? DEFAULT_MIP_SAMPLE_PLAN_FACILITY.alternateBusinessName,
    ).trim(),
  };
}

const MIP_TEST_TYPES = [
  { key: "RSA", labels: ["Residual Solvents", "RSA"] },
  { key: "Potency", labels: ["Potency"] },
  { key: "Metals", labels: ["Metals"] },
  { key: "Microbial", labels: ["Microbial"] },
  { key: "Mycotoxin", labels: ["Mycotoxin"] },
  { key: "Pesticides", labels: ["Pesticides"] },
  { key: "Terpenes", labels: ["Terpenes"] },
  { key: "Water", labels: ["Water", "Moisture"] },
  { key: "Homogeneity", labels: ["Homogeneity"] },
] as const;

export type MipSamplePlanModel = {
  facility: MipSamplePlanFacility;
  productionBatchId: string;
  productionBatchSizeGrams: string;
  productionDate: string;
  strainType: string;
  storageContainerCount: number;
  containers: Array<{ containerNum: string; metrc: string }>;
  procedureFollowed: string;
  notes: string;
  qualityNotes: string;
  testedMarks: Record<string, boolean>;
  testingFacility: string;
  sampleMetrcLine: string;
  printedAtLabel: string;
  extractionRunId: string;
};

function productionSizeGrams(process: ExtractionBatchSheetModel, batch: any): string {
  const final = String(process.finalOilGramsLabel || "").trim();
  if (final && final !== EM_DASH) return final;
  const biomass = String(process.totalBiomassGramsLabel || "").trim();
  if (biomass && biomass !== EM_DASH) return biomass;
  return "";
}

function buildNotes(process: ExtractionBatchSheetModel, batch: any): string {
  const parts: string[] = [];
  const product = String(process.productType || "").trim();
  if (product) parts.push(product);
  const materials = [...new Set(process.sourceRows.map((r) => r.material).filter(Boolean))];
  if (materials.length) parts.push(materials.join(", "));
  const run = String(process.runId || "").trim();
  if (run) parts.push(`Extraction run ${run}`);
  const status = String(process.status || "").trim();
  if (status) parts.push(status);
  return parts.join(" · ") || "";
}

function testedMarksFromBatch(batch: any): Record<string, boolean> {
  const tests: string[] = Array.isArray(batch?.taskData?.Testing?.tests)
    ? batch.taskData.Testing.tests.map((t: unknown) => String(t).trim())
    : [];
  const marks: Record<string, boolean> = {};
  for (const { key, labels } of MIP_TEST_TYPES) {
    marks[key] = tests.some((t) =>
      labels.some((label) => t.toLowerCase() === label.toLowerCase()),
    );
  }
  return marks;
}

function containerSlots(rows: ExtractionBatchSheetSourceRow[]): Array<{ containerNum: string; metrc: string }> {
  const slots: Array<{ containerNum: string; metrc: string }> = [];
  for (let i = 0; i < 8; i++) {
    const row = rows[i];
    if (row) {
      slots.push({
        containerNum: String(row.index),
        metrc: row.metrcTag && !row.metrcTag.includes("assign METRC") ? row.metrcTag : "",
      });
    } else {
      slots.push({ containerNum: String(i + 1), metrc: "" });
    }
  }
  return slots;
}

export function buildMipSamplePlanModel(
  batch: any,
  process: ExtractionBatchSheetModel,
  facility?: MipSamplePlanFacility,
  printedAt?: Date,
): MipSamplePlanModel {
  const fac = facility ?? DEFAULT_MIP_SAMPLE_PLAN_FACILITY;
  const containers = containerSlots(process.sourceRows);
  const withMetrc = process.sourceRows.filter(
    (r) => r.metrcTag && r.metrcTag !== EM_DASH && !r.metrcTag.includes("assign METRC"),
  );
  const printed = printedAt ?? new Date();

  return {
    facility: fac,
    productionBatchId: process.marketBatchCode,
    productionBatchSizeGrams: productionSizeGrams(process, batch),
    productionDate: String(batch?.createdAt || printed.toLocaleDateString()).trim(),
    strainType: process.sourceBlendLabel || process.batchName || EM_DASH,
    storageContainerCount: withMetrc.length || process.sourceRows.length,
    containers,
    procedureFollowed: "",
    notes: buildNotes(process, batch),
    qualityNotes: "",
    testedMarks: testedMarksFromBatch(batch),
    testingFacility: String(batch?.taskData?.Testing?.testingFacility || "").trim(),
    sampleMetrcLine: withMetrc.map((r) => r.metrcTag).join(", "),
    printedAtLabel: printed.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }),
    extractionRunId: process.runId,
  };
}

function renderContainerGrid(containers: MipSamplePlanModel["containers"]): string {
  const rows: string[] = [];
  for (let r = 0; r < 4; r++) {
    const left = containers[r * 2] ?? { containerNum: "", metrc: "" };
    const right = containers[r * 2 + 1] ?? { containerNum: "", metrc: "" };
    rows.push(`<tr>
      <td class="lbl">Container #</td><td>${field(left.containerNum)}</td>
      <td class="lbl">METRC #</td><td>${field(left.metrc)}</td>
      <td class="lbl">Container #</td><td>${field(right.containerNum)}</td>
      <td class="lbl">METRC #</td><td>${field(right.metrc)}</td>
    </tr>`);
  }
  return `<table class="grid">${rows.join("")}</table>`;
}

function renderSampleIncrementTable(): string {
  const cols = 4;
  const increments = 8;
  let html = '<table class="increments"><thead><tr>';
  for (let c = 0; c < cols; c++) {
    html += `<th>Col ${c + 1}</th>`;
  }
  html += "</tr></thead><tbody>";
  for (let i = 0; i < increments; i++) {
    html += "<tr>";
    for (let c = 0; c < cols; c++) {
      html += '<td class="loc">Location</td>';
    }
    html += "</tr><tr>";
    for (let c = 0; c < cols; c++) {
      html += '<td class="wt">0.25</td>';
    }
    html += "</tr>";
  }
  html += "</tbody></table>";
  return html;
}

function renderTestedLine(marks: Record<string, boolean>): string {
  return MIP_TEST_TYPES.map(({ key }) => {
    const on = marks[key];
    return `<span class="test${on ? " on" : ""}">(${key})</span>`;
  }).join(" ");
}

export function buildMipSamplePlanPrintHtml(model: MipSamplePlanModel): string {
  const f = model.facility;
  return `<section class="sheet mip">
  <h1>MIP Sample Plan</h1>
  <p class="sheet-tag">Sheet 2 of 2 — finalize for lab testing &amp; packaging handoff</p>
  <table class="form-lines">
    <tr><td class="lbl wide">Business Name:</td><td colspan="3">${field(f.businessName)}</td></tr>
    <tr><td class="lbl wide">Business License ID:</td><td colspan="3">${field(f.businessLicenseId)}</td></tr>
    <tr><td class="lbl wide">Facility Address:</td><td colspan="3">${field(f.facilityAddress)}</td></tr>
    <tr>
      <td class="lbl wide">Name of Test Batch Collector:</td>
      <td>${blankLine()}</td>
      <td class="lbl">Signature:</td>
      <td>${blankLine()}</td>
    </tr>
    <tr><td class="lbl wide">Employee License of Collector:</td><td colspan="3">${blankLine()}</td></tr>
    <tr><td class="lbl wide">Business(es) if different from that name above:</td><td colspan="3">${field(f.alternateBusinessName)}</td></tr>
  </table>
  <table class="form-lines two-col">
    <tr>
      <td class="lbl">Production Batch ID</td><td>${field(model.productionBatchId)}</td>
      <td class="lbl">Production Date</td><td>${field(model.productionDate)}</td>
    </tr>
    <tr>
      <td class="lbl">Production Batch Size (Grams)</td><td>${field(model.productionBatchSizeGrams)}</td>
      <td class="lbl">Strain/Type</td><td>${field(model.strainType)}</td>
    </tr>
  </table>
  <p class="inline-lbl">Number of Storage Containers: <strong>${model.storageContainerCount || blankLine()}</strong>
    <span class="muted"> · Extraction run ${field(model.extractionRunId)}</span></p>
  <div class="split">
    <div class="left">
      ${renderContainerGrid(model.containers)}
      <p class="inline-lbl">Procedure Followed: ${model.procedureFollowed ? field(model.procedureFollowed) : blankLine()}</p>
      <div class="box notes">
        <div class="box-lbl">Notes (e.g. remediated product, fresh frozen, etc.):</div>
        <div class="box-body">${model.notes ? field(model.notes) : blankLine()}</div>
      </div>
      <div class="box quality">
        <div class="box-lbl">Note anything that may affect the quality of the data analysis, such as color, thickness, processing technique (solvents used), etc.:</div>
        <div class="box-body tall">${model.qualityNotes ? field(model.qualityNotes) : blankLine()}</div>
      </div>
    </div>
    <div class="right">
      <div class="inc-title">Amounts/location of each Sample Increment Collected</div>
      ${renderSampleIncrementTable()}
      <table class="form-lines mini">
        <tr><td class="lbl">Total(g):</td><td>${blankLine()}</td></tr>
        <tr><td class="lbl">Time and Date:</td><td>${field(model.printedAtLabel)}</td></tr>
        <tr><td class="lbl">Metrc:</td><td>${field(model.sampleMetrcLine)}</td></tr>
      </table>
    </div>
  </div>
  <p class="tested"><span class="lbl-inline">Tested:</span> ${renderTestedLine(model.testedMarks)}</p>
  <table class="form-lines footer-sign">
    <tr><td class="lbl wide">Testing Facility:</td><td colspan="3">${model.testingFacility ? field(model.testingFacility) : blankLine()}</td></tr>
    <tr><td class="lbl wide">Employee License of Collector(s):</td><td colspan="3">${blankLine()}</td></tr>
    <tr>
      <td class="lbl">Reviewed by:</td><td>${blankLine()}</td>
      <td class="lbl">Print</td><td>${blankLine()}</td>
    </tr>
    <tr><td class="lbl">Sign</td><td>${blankLine()}</td><td class="lbl">Date</td><td>${blankLine()}</td></tr>
  </table>
</section>`;
}
