/**
 * Client-side METRC certification / evaluation tracking (per company).
 * Persists checklist progress and request history in localStorage — no server auth changes.
 */

export type MetrcEvaluationTaskId =
  | "facilities_sync"
  | "locations_sync"
  | "strains_sync"
  | "packages_sync"
  | "plant_batches_sync"
  | "create_plant_batch"
  | "create_harvest"
  | "create_package"
  | "transfers";

export type MetrcEvaluationTaskStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "not_available";

export type MetrcEvaluationTaskDefinition = {
  id: MetrcEvaluationTaskId;
  label: string;
  description: string;
  /** NexBatch API route invoked when Run / Retry is used. */
  nexbatchPath: string | null;
  method: "GET" | "POST" | "PATCH";
  /** When false, Run marks task as not_available with guidance (no API call). */
  runnable: boolean;
  notAvailableReason?: string;
};

export type MetrcEvaluationTaskRecord = {
  id: MetrcEvaluationTaskId;
  label: string;
  status: MetrcEvaluationTaskStatus;
  updatedAt: string | null;
  requestPayload: Record<string, unknown> | null;
  responsePayload: unknown;
  metrcStatusCode: number | null;
  httpStatus: number | null;
  durationMs: number | null;
  errorMessage: string | null;
  nexbatchPath: string | null;
  metrcEndpoint: string | null;
};

export type MetrcRequestHistoryEntry = {
  id: string;
  taskId: MetrcEvaluationTaskId | null;
  endpoint: string;
  method: string;
  status: "success" | "failed" | "error";
  durationMs: number;
  user: string;
  timestamp: string;
  httpStatus: number | null;
  metrcStatusCode: number | null;
  requestPayload: Record<string, unknown> | null;
  responsePayload: unknown;
  errorMessage: string | null;
};

export type MetrcEvaluationState = {
  version: 1;
  companyId: string;
  updatedAt: string;
  tasks: Record<MetrcEvaluationTaskId, MetrcEvaluationTaskRecord>;
  requestHistory: MetrcRequestHistoryEntry[];
};

export const METRC_EVALUATION_TASKS: MetrcEvaluationTaskDefinition[] = [
  {
    id: "facilities_sync",
    label: "Facilities Sync",
    description: "Pull METRC facilities into NexBatch.",
    nexbatchPath: "/api/metrc/facilities",
    method: "GET",
    runnable: true,
  },
  {
    id: "locations_sync",
    label: "Locations Sync",
    description: "Pull active METRC locations (rooms) and auto-map to NexBatch rooms when possible.",
    nexbatchPath: "/api/metrc/rooms",
    method: "GET",
    runnable: true,
  },
  {
    id: "strains_sync",
    label: "Strains Sync",
    description: "Pull active METRC strains and link to NexBatch strain catalog.",
    nexbatchPath: "/api/metrc/strains",
    method: "GET",
    runnable: true,
  },
  {
    id: "packages_sync",
    label: "Packages Sync",
    description: "Pull active METRC packages for inventory reconciliation.",
    nexbatchPath: "/api/metrc/packages",
    method: "GET",
    runnable: true,
  },
  {
    id: "plant_batches_sync",
    label: "Plant Batch Sync",
    description: "Pull active METRC plant batches for Clone → Veg workflows.",
    nexbatchPath: "/api/metrc/plant-batches",
    method: "GET",
    runnable: true,
  },
  {
    id: "create_plant_batch",
    label: "Create Plant Batch",
    description: "POST immature clone plant batch to METRC sandbox (admin test action).",
    nexbatchPath: null,
    method: "POST",
    runnable: false,
    notAvailableReason:
      "Use METRC Sandbox → Create Test Plant Batch (sandbox-only, confirmation required). Not runnable from this checklist without a POST body.",
  },
  {
    id: "create_harvest",
    label: "Create Harvest",
    description: "POST harvest to METRC.",
    nexbatchPath: null,
    method: "POST",
    runnable: false,
    notAvailableReason:
      "METRC harvest creation is not implemented in NexBatch API. Planned for a future evaluation write endpoint.",
  },
  {
    id: "create_package",
    label: "Create Package",
    description: "POST package to METRC.",
    nexbatchPath: null,
    method: "POST",
    runnable: false,
    notAvailableReason:
      "METRC package creation is not implemented in NexBatch API. Inbound package sync is available above.",
  },
  {
    id: "transfers",
    label: "Transfers",
    description: "METRC transfer outbound/inbound.",
    nexbatchPath: null,
    method: "POST",
    runnable: false,
    notAvailableReason:
      "METRC transfers are not implemented in NexBatch API. Cultivation extraction transfers are internal only.",
  },
];

const STORAGE_PREFIX = "metrc_evaluation_v1";

function storageKey(companyId: string) {
  return `${STORAGE_PREFIX}:${companyId}`;
}

function emptyTaskRecord(def: MetrcEvaluationTaskDefinition): MetrcEvaluationTaskRecord {
  return {
    id: def.id,
    label: def.label,
    status: def.runnable ? "pending" : "not_available",
    updatedAt: def.runnable ? null : new Date().toISOString(),
    requestPayload: null,
    responsePayload: null,
    metrcStatusCode: null,
    httpStatus: null,
    durationMs: null,
    errorMessage: def.runnable ? null : def.notAvailableReason ?? "Not available",
    nexbatchPath: def.nexbatchPath,
    metrcEndpoint: null,
  };
}

export function createEmptyEvaluationState(companyId: string): MetrcEvaluationState {
  const tasks = {} as Record<MetrcEvaluationTaskId, MetrcEvaluationTaskRecord>;
  for (const def of METRC_EVALUATION_TASKS) {
    tasks[def.id] = emptyTaskRecord(def);
  }
  return {
    version: 1,
    companyId,
    updatedAt: new Date().toISOString(),
    tasks,
    requestHistory: [],
  };
}

export function loadEvaluationState(companyId: string): MetrcEvaluationState {
  if (typeof window === "undefined") {
    return createEmptyEvaluationState(companyId);
  }
  try {
    const raw = window.localStorage.getItem(storageKey(companyId));
    if (!raw) return createEmptyEvaluationState(companyId);
    const parsed = JSON.parse(raw) as MetrcEvaluationState;
    if (parsed.version !== 1 || parsed.companyId !== companyId) {
      return createEmptyEvaluationState(companyId);
    }
    const base = createEmptyEvaluationState(companyId);
    return {
      ...base,
      ...parsed,
      tasks: { ...base.tasks, ...parsed.tasks },
      requestHistory: Array.isArray(parsed.requestHistory) ? parsed.requestHistory : [],
    };
  } catch {
    return createEmptyEvaluationState(companyId);
  }
}

export function saveEvaluationState(state: MetrcEvaluationState): void {
  if (typeof window === "undefined") return;
  const next = { ...state, updatedAt: new Date().toISOString() };
  window.localStorage.setItem(storageKey(state.companyId), JSON.stringify(next));
}

export function clearEvaluationState(companyId: string): MetrcEvaluationState {
  const empty = createEmptyEvaluationState(companyId);
  saveEvaluationState(empty);
  return empty;
}

export function exportEvaluationJson(state: MetrcEvaluationState): string {
  const checklist = METRC_EVALUATION_TASKS.map((def) => ({
    ...state.tasks[def.id],
    description: def.description,
    runnable: def.runnable,
  }));
  const payload = {
    exportedAt: new Date().toISOString(),
    companyId: state.companyId,
    checklist,
    requestHistory: state.requestHistory,
    summary: {
      totalTasks: METRC_EVALUATION_TASKS.length,
      passed: checklist.filter((t) => t.status === "passed").length,
      failed: checklist.filter((t) => t.status === "failed").length,
      pending: checklist.filter((t) => t.status === "pending").length,
      notAvailable: checklist.filter((t) => t.status === "not_available").length,
    },
    futureExportFormats: ["spreadsheet"],
  };
  return JSON.stringify(payload, null, 2);
}

export function downloadEvaluationJson(state: MetrcEvaluationState, filename?: string): void {
  const blob = new Blob([exportEvaluationJson(state)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download =
    filename ||
    `metrc-evaluation-${state.companyId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function newHistoryId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function taskStatusLabel(status: MetrcEvaluationTaskStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "running":
      return "Running";
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
    case "not_available":
      return "Not available";
    default:
      return status;
  }
}

export function taskStatusColor(status: MetrcEvaluationTaskStatus): string {
  switch (status) {
    case "passed":
      return "#4ade80";
    case "failed":
      return "#f87171";
    case "running":
      return "#38bdf8";
    case "not_available":
      return "#94a3b8";
    default:
      return "#fbbf24";
  }
}
