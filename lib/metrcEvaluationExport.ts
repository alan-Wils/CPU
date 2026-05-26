import * as XLSX from "xlsx";
import {
  METRC_EVALUATION_TASKS,
  taskStatusLabel,
  type MetrcEvaluationState,
  type MetrcEvaluationTaskStatus,
} from "@/lib/metrcEvaluation";

export type MetrcEvaluationExportMetadata = {
  environment?: string | null;
  activeFacilityLicense?: string | null;
};

function formatJsonCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function requestSummary(requestPayload: Record<string, unknown> | null): string {
  if (!requestPayload) return "";
  const method = String(requestPayload.method ?? "").trim();
  const path = String(requestPayload.path ?? "").trim();
  const body = requestPayload.body;
  const parts = [method, path].filter(Boolean);
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const keys = Object.keys(body as Record<string, unknown>).slice(0, 8);
    if (keys.length) parts.push(`body: {${keys.join(", ")}}`);
  }
  return parts.join(" ") || formatJsonCell(requestPayload);
}

function statusFlag(status: MetrcEvaluationTaskStatus, expected: MetrcEvaluationTaskStatus): string {
  return status === expected ? "Yes" : "";
}

function buildSummaryRows(state: MetrcEvaluationState): Record<string, string | number>[] {
  return METRC_EVALUATION_TASKS.map((def) => {
    const task = state.tasks[def.id];
    return {
      "Task Name": def.label,
      Status: taskStatusLabel(task.status),
      Passed: statusFlag(task.status, "passed"),
      Failed: statusFlag(task.status, "failed"),
      Pending: statusFlag(task.status, "pending"),
      "Duration (ms)": task.durationMs ?? "",
      "HTTP Status": task.httpStatus ?? "",
      "METRC Status": task.metrcStatusCode ?? "",
      Endpoint: task.nexbatchPath ?? def.nexbatchPath ?? "",
      Timestamp: task.updatedAt ?? "",
      "METRC Path": task.metrcEndpoint ?? "",
      "Request Summary": requestSummary(task.requestPayload),
      Notes: task.errorMessage ?? (def.runnable ? "" : def.notAvailableReason ?? ""),
    };
  });
}

function buildHistoryRows(state: MetrcEvaluationState): Record<string, string | number>[] {
  const taskLabelById = Object.fromEntries(
    METRC_EVALUATION_TASKS.map((def) => [def.id, def.label]),
  ) as Record<string, string>;

  return state.requestHistory.map((entry) => ({
    Timestamp: entry.timestamp,
    Task: entry.taskId ? taskLabelById[entry.taskId] ?? entry.taskId : "",
    Method: entry.method,
    Endpoint: entry.endpoint,
    "HTTP Status": entry.httpStatus ?? "",
    "METRC Status": entry.metrcStatusCode ?? "",
    Duration: entry.durationMs,
    User: entry.user,
    "Request Payload": formatJsonCell(entry.requestPayload),
    "Response Payload": formatJsonCell(entry.responsePayload),
  }));
}

function buildMetadataRows(
  state: MetrcEvaluationState,
  metadata: MetrcEvaluationExportMetadata,
): Record<string, string | number>[] {
  const tasks = Object.values(state.tasks);
  const passedCount = tasks.filter((t) => t.status === "passed").length;
  const failedCount = tasks.filter((t) => t.status === "failed").length;
  const pendingCount = tasks.filter((t) => t.status === "pending").length;

  const rows: Array<{ Field: string; Value: string | number }> = [
    { Field: "Company Id", Value: state.companyId },
    { Field: "Export Timestamp", Value: new Date().toISOString() },
    { Field: "Passed Count", Value: passedCount },
    { Field: "Failed Count", Value: failedCount },
    { Field: "Pending Count", Value: pendingCount },
    { Field: "Version", Value: state.version },
    { Field: "Environment", Value: metadata.environment ?? "" },
    { Field: "Active Facility License", Value: metadata.activeFacilityLicense ?? "" },
  ];
  return rows;
}

export function evaluationSpreadsheetFilename(date = new Date()): string {
  return `NexBatch_METRC_Evaluation_${date.toISOString().slice(0, 10)}.xlsx`;
}

export function buildEvaluationWorkbook(
  state: MetrcEvaluationState,
  metadata: MetrcEvaluationExportMetadata = {},
): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.json_to_sheet(buildSummaryRows(state));
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

  const historySheet = XLSX.utils.json_to_sheet(buildHistoryRows(state));
  XLSX.utils.book_append_sheet(workbook, historySheet, "History");

  const metadataSheet = XLSX.utils.json_to_sheet(buildMetadataRows(state, metadata));
  XLSX.utils.book_append_sheet(workbook, metadataSheet, "Export Metadata");

  return workbook;
}

export function downloadEvaluationSpreadsheet(
  state: MetrcEvaluationState,
  metadata: MetrcEvaluationExportMetadata = {},
): void {
  const workbook = buildEvaluationWorkbook(state, metadata);
  const filename = evaluationSpreadsheetFilename();
  XLSX.writeFile(workbook, filename);
}
