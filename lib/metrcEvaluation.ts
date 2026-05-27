/**
 * Client-side METRC certification / evaluation tracking (per company).
 * Persists checklist progress and request history in localStorage — no server auth changes.
 */

export type MetrcEvaluationTaskId =
  | "facilities_sync"
  | "locations_sync"
  | "strains_sync"
  | "create_strain"
  | "packages_sync"
  | "plant_batches_sync"
  | "create_plant_batch"
  | "harvests_sync"
  | "create_harvest"
  | "create_package"
  | "package_change_item"
  | "package_adjust"
  | "package_finish"
  | "package_unfinish"
  | "transfers_sync"
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
    id: "create_strain",
    label: "Create Strain",
    description:
      "POST test strain to METRC sandbox (sandbox-only). Runnable here or from METRC Sandbox — default NexBatch Test Strain at 50/50 Indica/Sativa.",
    nexbatchPath: "/api/metrc/strains/create-test",
    method: "POST",
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
    description:
      "POST immature clone plant batch to METRC sandbox (sandbox-only). Runnable here after a mapped veg room exists, or from METRC Sandbox.",
    nexbatchPath: "/api/metrc/plant-batches/create-test",
    method: "POST",
    runnable: true,
  },
  {
    id: "harvests_sync",
    label: "Harvest Sync",
    description: "Pull active METRC harvests for Plant Batch → Harvest workflows.",
    nexbatchPath: "/api/metrc/harvests",
    method: "GET",
    runnable: true,
  },
  {
    id: "create_harvest",
    label: "Create Harvest",
    description:
      "Sandbox harvest via PUT /plants/v2/harvest using individual plant tags. Promotes plant batch to flowering when needed — never sends batch names as Plant.",
    nexbatchPath: "/api/metrc/harvests/create-test",
    method: "POST",
    runnable: true,
  },
  {
    id: "create_package",
    label: "Create Package",
    description:
      "POST package from harvest to METRC sandbox via POST /harvests/v2/packages (sandbox-only). Runnable here after harvest + item sync, or from METRC Sandbox.",
    nexbatchPath: "/api/metrc/packages/create-test",
    method: "POST",
    runnable: true,
  },
  {
    id: "package_change_item",
    label: "Change Package Item",
    description:
      "PUT /packages/v2/item on the most recently synced sandbox package (sandbox-only). Uses synced package label and item catalog.",
    nexbatchPath: "/api/metrc/packages/change-item-test",
    method: "POST",
    runnable: true,
  },
  {
    id: "package_adjust",
    label: "Adjust Package",
    description:
      "PUT /packages/v2/adjust on the most recently synced sandbox package (sandbox-only). Fetches valid adjustment reasons from METRC first, then records a small evaluation adjustment.",
    nexbatchPath: "/api/metrc/packages/adjust-test",
    method: "POST",
    runnable: true,
  },
  {
    id: "package_finish",
    label: "Finish Package",
    description:
      "PUT /packages/v2/finish on the most recently synced sandbox package (sandbox-only). Run after Adjust Package when quantity is zero; METRC will reject finish if the package is not empty.",
    nexbatchPath: "/api/metrc/packages/finish-test",
    method: "POST",
    runnable: true,
  },
  {
    id: "package_unfinish",
    label: "Unfinish Package",
    description:
      "PUT /packages/v2/unfinish on the most recently synced sandbox package (sandbox-only). Run after Finish Package.",
    nexbatchPath: "/api/metrc/packages/unfinish-test",
    method: "POST",
    runnable: true,
  },
  {
    id: "transfers_sync",
    label: "Transfers Sync",
    description:
      "Pull incoming, outgoing, and template transfers from METRC (GET /transfers/v2/incoming, /outgoing, /templates/outgoing).",
    nexbatchPath: "/api/metrc/transfers",
    method: "GET",
    runnable: true,
  },
  {
    id: "transfers",
    label: "Transfers",
    description:
      "POST sandbox outgoing transfer template using the most recent transferable synced package with quantity > 0 (POST /transfers/v2/templates/outgoing). Skips zeroed/finished/on-hold packages.",
    nexbatchPath: "/api/metrc/transfers/create-test",
    method: "POST",
    runnable: true,
  },
];

const STORAGE_PREFIX = "metrc_evaluation_v1";

export const METRC_SANDBOX_CREATE_TASK_IDS = [
  "create_strain",
  "create_plant_batch",
  "create_harvest",
  "create_package",
  "package_change_item",
  "package_adjust",
  "package_finish",
  "package_unfinish",
  "transfers",
] as const;

export const METRC_EVALUATION_DEFAULT_PACKAGE_LABEL = "AAA00090000196B000000001";
export const METRC_EVALUATION_DEFAULT_PACKAGE_ID = "46601";
export const METRC_EVALUATION_DEFAULT_PACKAGE_LICENSE = "SF-SBX-CO-7-13402";
export const METRC_EVALUATION_ADJUST_QUANTITY = 0;

export const METRC_EVALUATION_DEFAULT_CREATE_PACKAGE_QUANTITY = 10;
export const METRC_EVALUATION_DEFAULT_CREATE_PACKAGE_UNIT = "Grams";
export type MetrcSandboxCreateTaskId = (typeof METRC_SANDBOX_CREATE_TASK_IDS)[number];

export type EvaluationFinishedPackageRef = {
  packageLabel: string;
  packageId: string;
  licenseNumber: string;
};

export const LATEST_FINISH_RESULT_REASON = "latest_finish_result" as const;

export type LatestFinishedEvaluationPackage = {
  packageLabel: string;
  licenseNumber: string;
  selectedReason: typeof LATEST_FINISH_RESULT_REASON;
};

function readEvaluationTrimmedString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function collectFinishChecklistResponseRoots(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const roots: Record<string, unknown>[] = [record];
  if (record.responsePayload && typeof record.responsePayload === "object") {
    roots.push(record.responsePayload as Record<string, unknown>);
  }
  return roots;
}

function extractFinishLabelFromMetrcBody(body: unknown): string {
  if (!Array.isArray(body) || !body[0] || typeof body[0] !== "object") return "";
  const row = body[0] as { Label?: unknown; label?: unknown };
  return readEvaluationTrimmedString(row.Label ?? row.label);
}

/** METRC mutation request nested inside a finish API response. */
export function resolveFinishChecklistMetrcRequestPayload(
  responsePayload: unknown,
  evaluationRequestPayload?: Record<string, unknown> | null,
): unknown {
  if (responsePayload && typeof responsePayload === "object") {
    const nested = (responsePayload as Record<string, unknown>).requestPayload;
    if (nested) return nested;
  }
  return evaluationRequestPayload ?? null;
}

function extractFinishPackageLabel(
  responsePayload: unknown,
  requestPayload: unknown,
): string {
  const responseRoots = collectFinishChecklistResponseRoots(responsePayload);
  const requestRoots = collectFinishChecklistResponseRoots(requestPayload);

  for (const root of responseRoots) {
    const label = readEvaluationTrimmedString(root.packageLabel);
    if (label) return label;
  }
  for (const root of responseRoots) {
    const label = readEvaluationTrimmedString(root.selectedPackageLabel);
    if (label) return label;
  }
  for (const root of responseRoots) {
    const spreadsheetFields = root.spreadsheetFields;
    if (spreadsheetFields && typeof spreadsheetFields === "object") {
      const label = readEvaluationTrimmedString(
        (spreadsheetFields as { tagNumber?: unknown }).tagNumber,
      );
      if (label) return label;
    }
  }
  for (const root of requestRoots) {
    const label = extractFinishLabelFromMetrcBody(root.body);
    if (label) return label;
  }
  for (const root of requestRoots) {
    const pkg = root.package;
    if (pkg && typeof pkg === "object" && !Array.isArray(pkg)) {
      const label = readEvaluationTrimmedString((pkg as { packageLabel?: unknown }).packageLabel);
      if (label) return label;
    }
  }
  return "";
}

function extractFinishLicenseNumber(
  responsePayload: unknown,
  requestPayload: unknown,
): string {
  const responseRoots = collectFinishChecklistResponseRoots(responsePayload);
  const requestRoots = collectFinishChecklistResponseRoots(requestPayload);

  for (const root of responseRoots) {
    const license = readEvaluationTrimmedString(root.licenseNumber);
    if (license) return license;
  }
  for (const root of requestRoots) {
    const license = readEvaluationTrimmedString(root.licenseNumber);
    if (license) return license;
  }
  for (const root of requestRoots) {
    const pkg = root.package;
    if (pkg && typeof pkg === "object" && !Array.isArray(pkg)) {
      const license = readEvaluationTrimmedString((pkg as { licenseNumber?: unknown }).licenseNumber);
      if (license) return license;
    }
  }
  return METRC_EVALUATION_DEFAULT_PACKAGE_LICENSE;
}

/**
 * Latest successful package_finish checklist result (id=package_finish, status=passed).
 * Does not use generic package resolvers, sync, or DB lookup.
 */
export function resolveLatestFinishedEvaluationPackage(input: {
  responsePayload?: unknown;
  requestPayload?: unknown;
}): LatestFinishedEvaluationPackage | null {
  const metrcRequest = resolveFinishChecklistMetrcRequestPayload(
    input.responsePayload,
    input.requestPayload as Record<string, unknown> | null,
  );
  const packageLabel = extractFinishPackageLabel(input.responsePayload, metrcRequest);
  if (!packageLabel) return null;

  return {
    packageLabel,
    licenseNumber: extractFinishLicenseNumber(input.responsePayload, metrcRequest),
    selectedReason: LATEST_FINISH_RESULT_REASON,
  };
}

function latestFinishedFromChecklistEntry(input: {
  responsePayload: unknown;
  requestPayload: Record<string, unknown> | null;
}): LatestFinishedEvaluationPackage | null {
  const metrcRequest = resolveFinishChecklistMetrcRequestPayload(
    input.responsePayload,
    input.requestPayload,
  );
  return resolveLatestFinishedEvaluationPackage({
    responsePayload: input.responsePayload,
    requestPayload: metrcRequest,
  });
}

/** Package identity from a successful Finish Package evaluation result. */
export function extractEvaluationPackageFromFinishPayload(
  responsePayload: unknown,
  requestPayload?: Record<string, unknown> | null,
): EvaluationFinishedPackageRef | null {
  const resolved = resolveLatestFinishedEvaluationPackage({ responsePayload, requestPayload });
  if (!resolved) return null;
  return {
    packageLabel: resolved.packageLabel,
    packageId: "",
    licenseNumber: resolved.licenseNumber,
  };
}

/** Latest passed package_finish checklist item (task record, then request history). */
export function resolveUnfinishPackageFromEvaluationState(
  state: MetrcEvaluationState,
): EvaluationFinishedPackageRef | null {
  const finishTask = state.tasks.package_finish;
  if (finishTask.status === "passed") {
    const fromTask = latestFinishedFromChecklistEntry({
      responsePayload: finishTask.responsePayload,
      requestPayload: finishTask.requestPayload,
    });
    if (fromTask) {
      return {
        packageLabel: fromTask.packageLabel,
        packageId: "",
        licenseNumber: fromTask.licenseNumber,
      };
    }
  }

  for (const entry of state.requestHistory) {
    if (entry.taskId !== "package_finish" || entry.status !== "success") continue;
    const fromHistory = latestFinishedFromChecklistEntry({
      responsePayload: entry.responsePayload,
      requestPayload: entry.requestPayload,
    });
    if (fromHistory) {
      return {
        packageLabel: fromHistory.packageLabel,
        packageId: "",
        licenseNumber: fromHistory.licenseNumber,
      };
    }
  }

  return null;
}

export const METRC_EVALUATION_DEFAULT_CREATE_STRAIN_REQUEST = {
  name: "NexBatch Test Strain",
  testingStatus: "None",
  indicaPercentage: 50,
  sativaPercentage: 50,
};

function storageKey(companyId: string) {
  return `${STORAGE_PREFIX}:${companyId}`;
}

function extractMetrcEndpointFromPayload(responsePayload: unknown): string | null {
  if (responsePayload && typeof responsePayload === "object" && "endpoint" in responsePayload) {
    const ep = (responsePayload as { endpoint?: unknown }).endpoint;
    return typeof ep === "string" ? ep : null;
  }
  return null;
}

function extractMetrcStatusFromPayload(responsePayload: unknown, httpStatus: number): number | null {
  if (responsePayload && typeof responsePayload === "object" && "status" in responsePayload) {
    const s = (responsePayload as { status?: unknown }).status;
    if (typeof s === "number") return s;
  }
  return httpStatus >= 400 ? httpStatus : null;
}

function isEvaluationSuccessResponse(httpStatus: number, responsePayload: unknown): boolean {
  if (httpStatus < 200 || httpStatus >= 300) return false;
  if (responsePayload && typeof responsePayload === "object" && "ok" in responsePayload) {
    return Boolean((responsePayload as { ok?: boolean }).ok);
  }
  return true;
}

function migrateTaskRecord(
  def: MetrcEvaluationTaskDefinition,
  existing: MetrcEvaluationTaskRecord,
): MetrcEvaluationTaskRecord {
  if (!def.runnable || existing.status !== "not_available") {
    return existing;
  }
  return {
    ...emptyTaskRecord(def),
    id: def.id,
    label: def.label,
    nexbatchPath: def.nexbatchPath,
  };
}

export function reconcileEvaluationState(state: MetrcEvaluationState): MetrcEvaluationState {
  const tasks = { ...state.tasks };

  for (const def of METRC_EVALUATION_TASKS) {
    tasks[def.id] = migrateTaskRecord(def, tasks[def.id]);
  }

  for (const taskId of METRC_SANDBOX_CREATE_TASK_IDS) {
    const latestSuccess = state.requestHistory.find(
      (entry) => entry.taskId === taskId && entry.status === "success",
    );
    if (!latestSuccess) continue;

    const def = METRC_EVALUATION_TASKS.find((t) => t.id === taskId);
    if (!def) continue;

    tasks[taskId] = {
      ...tasks[taskId],
      id: taskId,
      label: def.label,
      status: "passed",
      updatedAt: latestSuccess.timestamp,
      requestPayload: latestSuccess.requestPayload,
      responsePayload: latestSuccess.responsePayload,
      metrcStatusCode: latestSuccess.metrcStatusCode,
      httpStatus: latestSuccess.httpStatus,
      durationMs: latestSuccess.durationMs,
      errorMessage: null,
      nexbatchPath: def.nexbatchPath,
      metrcEndpoint:
        extractMetrcEndpointFromPayload(latestSuccess.responsePayload) ??
        tasks[taskId].metrcEndpoint,
    };
  }

  return { ...state, tasks };
}

export function buildEvaluationCreateRequestBody(
  taskId: MetrcSandboxCreateTaskId,
  task: MetrcEvaluationTaskRecord,
  state?: MetrcEvaluationState | null,
): Record<string, unknown> {
  if (taskId === "package_adjust") {
    const defaults: Record<string, unknown> = {
      packageLabel: "",
      packageId: "",
      licenseNumber: METRC_EVALUATION_DEFAULT_PACKAGE_LICENSE,
      quantity: METRC_EVALUATION_ADJUST_QUANTITY,
      adjustmentDate: new Date().toISOString().slice(0, 10),
      reasonNote: "NexBatch evaluation",
    };
    const stored = task.requestPayload;
    if (stored && typeof stored === "object") {
      const body = (stored as { body?: unknown }).body ?? stored;
      if (body && typeof body === "object" && !Array.isArray(body)) {
        const merged = { ...defaults, ...(body as Record<string, unknown>) };
        merged.packageLabel = "";
        merged.packageId = "";
        delete merged.adjustmentReason;
        merged.quantity = METRC_EVALUATION_ADJUST_QUANTITY;
        return merged;
      }
    }
    return defaults;
  }

  if (taskId === "create_package") {
    const defaults: Record<string, unknown> = {
      metrcHarvestId: "",
      metrcItemId: "",
      packageTag: "",
      quantity: METRC_EVALUATION_DEFAULT_CREATE_PACKAGE_QUANTITY,
      unitOfMeasure: METRC_EVALUATION_DEFAULT_CREATE_PACKAGE_UNIT,
      packagedDate: new Date().toISOString().slice(0, 10),
    };
    const stored = task.requestPayload;
    if (stored && typeof stored === "object") {
      const body = (stored as { body?: unknown }).body ?? stored;
      if (body && typeof body === "object" && !Array.isArray(body)) {
        const merged = { ...defaults, ...(body as Record<string, unknown>) };
        merged.packageTag = "";
        return merged;
      }
    }
    return defaults;
  }

  if (taskId === "package_unfinish") {
    const defaults: Record<string, unknown> = {
      packageLabel: "",
      packageId: "",
      licenseNumber: METRC_EVALUATION_DEFAULT_PACKAGE_LICENSE,
      itemName: "",
      adjustmentDate: new Date().toISOString().slice(0, 10),
      actualDate: new Date().toISOString().slice(0, 10),
      reasonNote: "NexBatch evaluation",
    };
    const finishTask = state?.tasks.package_finish;
    const fromFinish =
      finishTask?.status === "passed"
        ? resolveLatestFinishedEvaluationPackage({
            responsePayload: finishTask.responsePayload,
            requestPayload: resolveFinishChecklistMetrcRequestPayload(
              finishTask.responsePayload,
              finishTask.requestPayload,
            ),
          })
        : state
          ? (() => {
              const legacy = resolveUnfinishPackageFromEvaluationState(state);
              return legacy
                ? {
                    packageLabel: legacy.packageLabel,
                    licenseNumber: legacy.licenseNumber,
                    selectedReason: LATEST_FINISH_RESULT_REASON,
                  }
                : null;
            })()
          : null;
    if (fromFinish) {
      return {
        ...defaults,
        packageLabel: fromFinish.packageLabel,
        selectedPackageLabel: fromFinish.packageLabel,
        packageId: "",
        licenseNumber: fromFinish.licenseNumber,
        finishChecklistResponse: finishTask?.responsePayload ?? null,
        finishChecklistRequest: resolveFinishChecklistMetrcRequestPayload(
          finishTask?.responsePayload,
          finishTask?.requestPayload ?? null,
        ),
      };
    }
    return defaults;
  }

  if (taskId === "package_change_item" || taskId === "package_finish") {
    const defaults: Record<string, unknown> = {
      packageLabel: "",
      packageId: "",
      licenseNumber: METRC_EVALUATION_DEFAULT_PACKAGE_LICENSE,
      itemName: "",
      adjustmentDate: new Date().toISOString().slice(0, 10),
      actualDate: new Date().toISOString().slice(0, 10),
      reasonNote: "NexBatch evaluation",
    };
    const stored = task.requestPayload;
    if (stored && typeof stored === "object") {
      const body = (stored as { body?: unknown }).body ?? stored;
      if (body && typeof body === "object" && !Array.isArray(body)) {
        const merged = { ...defaults, ...(body as Record<string, unknown>) };
        merged.packageLabel = "";
        merged.packageId = "";
        return merged;
      }
    }
    return defaults;
  }

  const stored = task.requestPayload;
  if (stored && typeof stored === "object") {
    const body = (stored as { body?: unknown }).body ?? stored;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return { ...(body as Record<string, unknown>) };
    }
  }

  if (taskId === "create_strain") {
    return { ...METRC_EVALUATION_DEFAULT_CREATE_STRAIN_REQUEST };
  }

  if (taskId === "create_plant_batch") {
    return {
      name: "NexBatch Test Batch",
      strain: METRC_EVALUATION_DEFAULT_CREATE_STRAIN_REQUEST.name,
      count: 25,
      plantingDate: new Date().toISOString().slice(0, 10),
      batchType: "Clone",
    };
  }

  if (taskId === "create_harvest") {
    return {
      metrcPlantBatchId: "",
      harvestName: "NexBatch Test Harvest",
      harvestType: "Product",
      wetWeight: 100,
      unitOfWeight: "Grams",
      actualDate: new Date().toISOString().slice(0, 10),
    };
  }

  if (taskId === "transfers") {
    const defaults: Record<string, unknown> = {
      packageLabel: "",
      destinationFacilityLicense: "",
      transferDate: new Date().toISOString().slice(0, 10),
      plannedRoute: "NexBatch sandbox evaluation — direct facility transfer.",
      notes: "NexBatch Test Transfer",
      transferTypeName: "",
    };
    const stored = task.requestPayload;
    if (stored && typeof stored === "object") {
      const body = (stored as { body?: unknown }).body ?? stored;
      if (body && typeof body === "object" && !Array.isArray(body)) {
        const merged = { ...defaults, ...(body as Record<string, unknown>) };
        merged.packageLabel = "";
        return merged;
      }
    }
    return defaults;
  }

  return {
    packageLabel: "",
    destinationFacilityLicense: "",
    transferDate: new Date().toISOString().slice(0, 10),
    plannedRoute: "NexBatch sandbox evaluation — direct facility transfer.",
    notes: "NexBatch Test Transfer",
    transferTypeName: "",
  };
}

export type RecordSandboxCreateEvaluationInput = {
  companyId: string;
  taskId: MetrcSandboxCreateTaskId;
  endpoint: string;
  httpStatus: number;
  durationMs: number;
  requestPayload: Record<string, unknown>;
  responsePayload: unknown;
  user: string;
  passed: boolean;
  errorMessage?: string | null;
};

/** Persist a sandbox create-test run into evaluation checklist + history. */
export function recordSandboxCreateEvaluation(input: RecordSandboxCreateEvaluationInput): void {
  if (!input.companyId) return;

  const current = reconcileEvaluationState(loadEvaluationState(input.companyId));
  const def = METRC_EVALUATION_TASKS.find((t) => t.id === input.taskId);
  if (!def) return;

  const updatedAt = new Date().toISOString();
  const metrcStatusCode = extractMetrcStatusFromPayload(input.responsePayload, input.httpStatus);
  const metrcEndpoint = extractMetrcEndpointFromPayload(input.responsePayload);
  const requestPayload: Record<string, unknown> = {
    method: "POST",
    path: input.endpoint,
    source: "metrc_sandbox",
    body: input.requestPayload,
    companyId: input.companyId,
    recordedAt: updatedAt,
  };

  const taskRecord: MetrcEvaluationTaskRecord = {
    ...current.tasks[input.taskId],
    id: input.taskId,
    label: def.label,
    status: input.passed ? "passed" : "failed",
    updatedAt,
    requestPayload,
    responsePayload: input.responsePayload,
    metrcStatusCode,
    httpStatus: input.httpStatus || null,
    durationMs: input.durationMs,
    errorMessage: input.passed ? null : input.errorMessage ?? "Create failed",
    nexbatchPath: def.nexbatchPath,
    metrcEndpoint,
  };

  const historyEntry: MetrcRequestHistoryEntry = {
    id: newHistoryId(),
    taskId: input.taskId,
    endpoint: input.endpoint,
    method: "POST",
    status: input.passed ? "success" : input.httpStatus ? "failed" : "error",
    durationMs: input.durationMs,
    user: input.user,
    timestamp: updatedAt,
    httpStatus: input.httpStatus || null,
    metrcStatusCode,
    requestPayload,
    responsePayload: input.responsePayload,
    errorMessage: input.passed ? null : input.errorMessage ?? "Create failed",
  };

  saveEvaluationState({
    ...current,
    tasks: { ...current.tasks, [input.taskId]: taskRecord },
    requestHistory: [historyEntry, ...current.requestHistory].slice(0, 200),
  });
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
    const merged: MetrcEvaluationState = {
      ...base,
      ...parsed,
      tasks: { ...base.tasks, ...parsed.tasks },
      requestHistory: Array.isArray(parsed.requestHistory) ? parsed.requestHistory : [],
    };
    return reconcileEvaluationState(merged);
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
    futureExportFormats: [],
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
